# Admin Functions

## Admin email (current status)

### Implemented
- 1:1 admin email from the roster (welcome or custom) in the admin UI.
  - UI: `app/admin/admin-client.tsx`
  - API: `POST /api/admin/email/send` (`app/api/admin/email/send/route.ts`)
- Email logging + per-user metadata updates (last sent, welcome sent).
  - Logging: `lib/admin/email-log.ts`
  - Displayed in admin roster as the email badge/status.
- Refund confirmation emails use the same admin email endpoint.

### Not implemented yet
- Tier-targeted broadcast emails (all members, or by tier).
- "Send test to me" for broadcasts.
- Broadcast queuing/throttling + suppression/bounce handling.

