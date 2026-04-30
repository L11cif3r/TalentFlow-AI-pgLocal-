# Security Specification - TalentFlow AI

## Data Invariants
1. A `JobProfile` must always be associated with a `userId`.
2. A `Candidate` must always belong to a `jobId` and that `jobId` must belong to the same `userId`.
3. An `OutreachMessage` must always belong to a `candidateId` which in turn belongs to the user.
4. Users can only read/write their own data.
5. All IDs must be correctly formatted strings.

## The "Dirty Dozen" Payloads (Red Team Test Cases)
1. **Malicious Ownership**: Create a `JobProfile` with another user's `userId`.
2. **Path Injection**: Attempt to create a document with an ID containing path traversal characters like `../../`.
3. **Ghost Fields**: Add an `isAdmin: true` field to a `JobProfile`.
4. **Size Attack**: Post a 1MB string into the `title` field.
5. **Relational Bypass**: Create a `Candidate` under a `jobId` that the user does not own.
6. **Immutable Tampering**: Update the `createdAt` timestamp of an existing `JobProfile`.
7. **Type Poisoning**: Send a numeric value for the `title` field.
8. **Enum Violation**: Set candidate `status` to `hired` (not in allowed enum).
9. **Blanket Query**: Attempt to list all `JobProfiles` without a `userId` filter.
10. **Spoofing**: Update another user's `JobProfile` by guessing the document ID.
11. **Self-Promotion**: Attempt to write to a hypothetical `admins` collection.
12. **Orphaned Message**: Create an `OutreachMessage` for a `candidateId` that does not exist in the user's jobs.

## The Test Runner
(I will implement `firestore.rules.test.ts` if requested, but for now I will focus on the rules themselves).
