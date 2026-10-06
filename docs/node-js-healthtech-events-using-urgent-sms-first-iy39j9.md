# Node.js Healthtech Events Using Urgent SMS-First Email Fallback Polling

For an urgent healthtech contact form, the bill is usually driven by delivery attempts and status checks, while the operational risk is driven by retained personal data. The practical design is therefore a bounded state machine: classify the request once, enqueue one SMS attempt, poll only until a fixed deadline, and then send one idempotent email fallback to the same support queue. Keep the decision record longer than the message body, and make US or EU handling a policy input rather than scattered conditionals.

That is the short answer. A retry loop alone cannot distinguish a delayed receipt from a failed attempt, and it can quietly multiply both traffic and duplicate notifications. The unit of correctness is not "an API call succeeded"; it is a durable transition, tied to a contact event, that proves why the system attempted a channel and why it stopped.

## What does the notification bill actually contain?

Start with a countable model. For event \(e\), let \(S_e\) be SMS submissions, \(P_e\) status polls, \(E_e\) email submissions, and \(R_e\) retained bytes multiplied by retention time. The workload is the sum of those terms across events. No public price is needed to see the dominant term: if every pending SMS is polled without a deadline, \(P_e\) has no useful bound, whereas a policy with four scheduled observations makes \(P_e \leq 4\). The coefficient attached to each term can later come from an organization's actual contracts and storage system.

Consider an illustrative routing policy, not a claim about carrier timing: poll at 15, 45, 105, and 225 seconds after submission; if no accepted terminal receipt is recorded by the last observation, atomically authorize email. With 10,000 contact events, the upper bound is 40,000 scheduled polls, 10,000 SMS submissions, and 10,000 email submissions. Actual email volume is lower whenever SMS reaches the policy's accepted terminal state before its deadline. These numbers are deliberately policy constants, so a team can change them after observing its own receipt distribution without changing the state machine.

The change that moves the dominant term is mundane: replace open-ended polling with scheduled, deduplicated observations, and cancel the remaining observations as soon as a terminal state is persisted. Webhook receipts can reduce active polling further, but they do not remove the need for the same authenticated, idempotent transition handler. Either input may arrive twice or out of order.

**Bound the work before optimizing the transport.**

## How should Node.js route urgent event notifications with SMS first?

An accepted submission records that a transport took responsibility for a request. Delivery status is a later fact, exposed through status callbacks or retrieval according to the transport interface. Twilio's SMS documentation, for example, treats messaging and message status as distinct concerns; the architectural lesson is general and does not depend on that service.

This separation creates an uncomfortable interval. A healthtech form may contain an urgent scheduling issue, an access problem, or a clinical-sounding phrase that must be routed to a trained queue, yet the notification worker must not infer that an initial acceptance means a person received anything. It should persist the provider-neutral status, the provider's raw status as evidence, the observation time, and the rule version used to interpret it. The queue assignment itself should already exist before notification begins, because a notification channel is a wake-up mechanism, not the system of record for the support case. Picture the awkward ordering: the send request times out after remote acceptance, the worker restarts and submits its job again, a delivery receipt reaches the callback before the second worker polls, and the original polling job wakes after email has become eligible. Every individual operation can be reasonable while the combined result is two text messages, one email, and no trustworthy explanation. A durable event version, stable idempotency key, and monotonic transition rule make the ordering survivable: the callback and poll compete to record evidence, but only the transaction holding the expected event version may authorize the next business action.

Receipts arrive late.

Do not race SMS and email by default. That shortens latency, but it doubles disclosure paths and makes acknowledgement ambiguous. Sequential escalation accepts a bounded delay in exchange for a cleaner audit trail: SMS gets a defined opportunity, then email becomes eligible exactly once. For a locally defined critical class, a different rule may deliberately authorize both channels; that is a separate policy, with a separate reason code, rather than an exception buried in retry code.

## Persist the decision, not the loop

The Node.js intake service should commit the contact event and an outbox record in the same database transaction, then let a worker claim due transitions. The following Go example is intentionally a transport-neutral sketch of that worker boundary; SQL constraints and transaction isolation provide the final serialization, while the interface keeps transport-specific statuses outside the policy core.

```go
package notify

import (
	"context"
	"errors"
	"time"
)

type Stage string

const (
	SMSReady     Stage = "sms_ready"
	SMSPending   Stage = "sms_pending"
	EmailReady   Stage = "email_ready"
	Done         Stage = "done"
)

type Event struct {
	ID             string
	Region         string
	Queue          string
	Stage          Stage
	Attempt        int
	NextCheckAt    time.Time
	EscalateAt     time.Time
	RuleVersion    string
	TransportRef   string
}

type Receipt struct {
	Terminal  bool
	Accepted  bool
	RawStatus string
}

type Store interface {
	ClaimDue(ctx context.Context, eventID string, now time.Time) (Event, error)
	RecordSMS(ctx context.Context, event Event, idempotencyKey, ref string, next time.Time) error
	RecordReceipt(ctx context.Context, event Event, receipt Receipt, observed time.Time) error
	AuthorizeEmail(ctx context.Context, event Event, reason, idempotencyKey string) error
}

type SMS interface {
	Send(ctx context.Context, event Event, idempotencyKey string) (string, error)
	Poll(ctx context.Context, ref string) (Receipt, error)
}

var ErrNotDue = errors.New("event is not due")

func Advance(ctx context.Context, store Store, sms SMS, eventID string, now time.Time) error {
	e, err := store.ClaimDue(ctx, eventID, now)
	if err != nil {
		return err
	}

	switch e.Stage {
	case SMSReady:
		key := e.ID + ":sms:1"
		ref, err := sms.Send(ctx, e, key)
		if err != nil {
			return err
		}
		return store.RecordSMS(ctx, e, key, ref, now.Add(15*time.Second))

	case SMSPending:
		receipt, err := sms.Poll(ctx, e.TransportRef)
		if err != nil {
			return err
		}
		if err := store.RecordReceipt(ctx, e, receipt, now); err != nil {
			return err
		}
		if receipt.Terminal && receipt.Accepted {
			return nil
		}
		if receipt.Terminal || !now.Before(e.EscalateAt) {
			return store.AuthorizeEmail(ctx, e, "sms_deadline_or_terminal_failure", e.ID+":email:1")
		}
		return nil // The scheduler derives the next check from the versioned policy.

	default:
		return ErrNotDue
	}
}
```

The key detail is the storage contract. `ClaimDue` must lock or compare-and-swap the current version; `RecordSMS`, `RecordReceipt`, and `AuthorizeEmail` must append an audit entry and update current state atomically. A unique constraint on `(event_id, channel, attempt)` turns duplicate jobs into reads of an existing result. The transport call and database commit still cannot form one atomic transaction, so the idempotency key must be reused after an ambiguous timeout, and reconciliation must search for attempts whose call outcome is unknown.

Exactly once is the business invariant, not a network promise. The worker may execute repeatedly. One logical SMS attempt and one fallback authorization remain observable.

## Regional policy belongs beside consent and retention

"US" and "EU" are not sufficient compliance decisions. They are routing inputs from which an approved policy selects templates, sender configuration, consent evidence, quiet-hour behavior, escalation deadlines, and retention classes. The application should record the policy version and resolved region with each decision; it should not copy legal assumptions into a growing branch tree. Legal and security owners must define those policies for the actual use case and jurisdictions.

Transactional support notices should also stay separate from marketing mail. RFC 8058 defines a one-click unsubscribe mechanism using `List-Unsubscribe-Post` for applicable mailing-list messages; it does not turn an urgent support notification into marketing, nor does it replace the organization's classification and consent work. If the email fallback is part of a subscription stream to which that mechanism applies, implement the standard as specified and test that unsubscribe processing cannot suppress a distinct, legally required message class.

Minimize content at the channel boundary. An SMS can carry a case reference and a request to sign in, while the support system retains the full form under its own access controls. Email can do the same. Queue identifiers should describe operational ownership without exposing a diagnosis or sensitive phrase in a subject line, log field, metric label, or idempotency key.

## Operate from invariants and reconciliation

Deployment should begin with shadow decisions: compute the next transition, record what would happen, and compare it with the existing route without sending a second notification. Then enable a small policy cohort, with an immediate switch that prevents new sends while leaving receipt ingestion and reconciliation active. A stopped sender that also stops recording late receipts destroys evidence at precisely the wrong moment.

The useful service-level indicators follow the state machine: age of the oldest unprocessed outbox entry, time from form commit to first attempt, fraction reaching an accepted terminal state before the deadline, fallback authorization rate, ambiguous-attempt count, and reconciliation lag. Do not put phone numbers, email addresses, free-form text, or case IDs in metric labels. Logs can refer to a pseudonymous event identifier and audit sequence number, with access and retention controlled separately.

| Observed state | Authorized action | Evidence to retain |
| --- | --- | --- |
| SMS accepted, receipt pending | Schedule the next bounded observation | Attempt key, transport reference, observation time |
| SMS terminal and accepted | Cancel later work | Raw status, interpreted status, rule version |
| SMS terminal failure or deadline reached | Authorize email once | Reason code, email idempotency key, event version |
| Outcome remains ambiguous | Reconcile before creating a new attempt | Attempt history and last known transport evidence |

Testing needs adversarial ordering. Submit the same job twice; deliver a receipt before the polling job runs; deliver a failure after email authorization; time out after the transport accepted a request; and run two workers against the same due event. A deterministic clock and recorded transport doubles make these cases reproducible. The most important assertion is not the number of function calls, because retries legitimately alter that number; assert the durable sequence of authorized business actions and their reason codes.

Reconciliation closes the gap left by every distributed transaction. Periodically scan for SMS attempts with no known outcome past their observation window, email authorizations with no submission record, and terminal events that still have scheduled work. Repair by replaying the idempotent transition, never by manually editing the current status without an audit entry.

## Keep less content and more evidence

The deliberate retention split is simple: expire raw contact text and rendered channel payloads on the shortest approved schedule, while retaining a compact decision ledger for the separately approved audit period. That ledger needs identifiers, timestamps, state transitions, hashes or template versions where appropriate, reason codes, policy versions, and transport references; it does not need a second copy of the patient's prose.

This choice has a cost during an incident. Once payloads expire, an operator may be unable to reconstruct the exact words rendered by an old template or prove content byte for byte. Template versioning, immutable deployment artifacts, and content hashes recover part of that capability, but not personalized text that was intentionally deleted. **The trade-off is reduced investigative detail in exchange for a smaller disclosure surface.** Record that limitation in the retention decision, test deletion as seriously as delivery, and let the approved policy decide the boundary.

The resulting system is modest: one durable intake, one versioned routing policy, bounded SMS observation, one idempotent email fallback, and a reconciliation process that assumes every boundary can return an ambiguous result. That shape gives a healthtech support team a defensible answer to both operational questions: who was supposed to be notified, and what evidence justifies the next action?

## Further reading

- RFC 8058, "Signaling One-Click Functionality for List Email Headers": https://datatracker.ietf.org/doc/html/rfc8058
- Twilio SMS documentation, including message delivery and status concepts: https://www.twilio.com/docs/sms
