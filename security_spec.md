# Firestore Security Specification

## 1. Data Invariants
1. All user workspace state (`/users/{userId}/workspace/{docId}`), conversations (`/users/{userId}/conversations/{convId}`), saved study notes (`/users/{userId}/studyNotes/{noteId}`), study templates, and PII profiles strictly belong to `{userId}` (`request.auth.uid == userId` and `ownerId == request.auth.uid`).
2. `workspace/{docId}` only permits `docId == 'state'` and strictly allowlists settings keys; API secrets/tokens are never stored in Firestore workspace state.
3. Every collection forbids shadow/ghost fields via `hasAll(...) && hasOnly(...)` on write and `diff().affectedKeys().hasOnly(...)` on update.
4. `createdAt` is immutable and all write timestamps must equal `request.time`.
5. `email_verified == true` is required for all writes (`create` and `update`).
6. All path document IDs (`userId`, `convId`, `noteId`, `templateId`) must pass `isValidId()` (`^[a-zA-Z0-9_\-]+$`, length 1–128) on single-document operations.
7. All `allow list` rules explicitly enforce `isOwner(userId) && resource.data.ownerId == request.auth.uid`.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read or write on `/users/u1/workspace/state` (`request.auth == null`).
2. Cross-tenant `get` on `/users/u2/conversations/c1` while signed in as `u1`.
3. Cross-tenant `list` on `/users/u2/studyNotes` while signed in as `u1`.
4. Identity spoofing on `create`: `ownerId: "u2"` written inside `/users/u1/conversations/c1` as `u1`.
5. Shadow/ghost field injection: adding `isAdmin: true` or `role: "superadmin"` on `workspace/state` or `private/profile`.
6. Unverified email write: `email_verified: false` attempting `create` on `/users/u1/studyNotes/n1`.
7. Document ID poisoning: `/users/u1/conversations/${'a'.repeat(200)}` or invalid characters `conv/../admin`.
8. Oversized string DoS: `title` > 200 chars or `studyInstructions` > 4000 chars or `content` > 120000 chars.
9. Client timestamp tampering: setting `createdAt` or `updatedAt` to a past timestamp instead of `request.time`.
10. Immutable field mutation: changing `ownerId` or `createdAt` on `update`.
11. Unbounded array abuse: `messages` array > 300 elements or `agents`/`servers` > 50 elements.
12. Wrong singleton doc ID: writing `/users/u1/workspace/arbitraryDoc` instead of `state`.
