# MB Bloods Admin Backend

Standalone Admin API service for Mahesh Babu Bloods platform.

## Features
- Admin authentication & WhatsApp OTP verification
- Donor database query, filtering, verification, and CSV export
- Announcement alert management
- Feedback moderation (approval / deletion)
- Image gallery uploads

## Endpoints
- `POST /api/v1/admin/send-otp`: Request admin OTP
- `POST /api/v1/admin/login`: Verify OTP and issue JWT
- `GET /api/v1/admin/stats`: Get donor statistics by blood group
- `GET /api/v1/admin/donors`: Retrieve and filter registered donors
- `GET /api/v1/admin/donors/verify/:id`: Toggle donor verification status
- `GET /api/v1/admin/donors/delete/:id`: Delete donor record
- `GET /api/v1/admin/export`: Export donor records as CSV
- `POST /api/v1/admin/alerts`: Publish urgent alert
- `GET /api/v1/admin/feedbacks`: View all feedback
- `POST /api/v1/admin/feedbacks/approve/:id`: Toggle feedback approval status
- `DELETE /api/v1/admin/feedbacks/:id`: Delete feedback entry
