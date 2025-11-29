# Email Update Plan

This app uses passwordless email (NextAuth + DynamoDB adapter) and wallets. Changing an email must be verified to avoid account takeover and must keep the Dynamo user item and its GSI in sync.

## Goals
- Let a signed-in user request an email change from Edit Profile.
- Prove ownership of the new email via a magic-link verification step before switching.
- Keep Dynamo user + GSI consistent; avoid collisions with existing accounts.
- Ensure sessions pick up the new email (prompt re-login/refresh if needed).

## Backend changes
1) **Request endpoint** (`POST /api/profile/request-email-change`)
   - Auth via `getToken`.
   - Validate new email format.
   - Reject if `adapter.getUserByEmail(newEmail)` returns a user (collision).
   - Create a short-lived pending token (reuse `VerificationToken` table or a small Dynamo item keyed by `EMAIL_CHANGE#<userId>` storing newEmail+expires).
   - Send a magic link to the new email containing the token (reuse the NextAuth Email transport).

2) **Confirm endpoint** (`GET /api/profile/confirm-email-change?token=...`)
   - Load and validate the pending token; reject if missing/expired.
   - Re-check collision: `getUserByEmail(newEmail)` must be null or the same user.
   - Update the user email atomically, including GSI fields used by the Dynamo adapter:
     - Item keys: `pk/sk = USER#<id>`
     - GSI: `GSI1PK/GSI1SK = USER#<email>`
     - If `updateUser` doesn’t refresh GSI, perform a `put` of the merged record with new email and GSI values.
   - Delete the pending token.
   - Return a success view; optionally invalidate sessions so the user reauths with the new email.

## Frontend (Edit Profile)
- Add a “Change email” control in Edit Profile.
- Flow:
  - User enters new email, submit → call `request-email-change`.
  - On success, show “Check your new email for a confirmation link” and optionally show “Pending verification to <email>.”
- Add a confirmation landing page that calls `confirm-email-change` on load and displays success/failure, prompting re-sign-in if required.

## Validation and safety
- Reject invalid email formats on both client and server.
- Reject emails already in use.
- Short token lifetime (e.g., 15–30 minutes); one-time use.
- Optional rate limiting per user/IP.

## Testing checklist
- Invalid email → rejected (client + server).
- Email already in use → rejected.
- Expired/used token → rejected.
- Successful change updates Dynamo user email and GSI; old email no longer signs in; new email works.
- Wallet linking and membership state remain intact.
