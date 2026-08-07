# User Authentication

## Overview
Unified login with SMS OTP, WeChat auth, admin password auth.

## Platforms affected
- **app**: SMS OTP login, biometric unlock
- **h5**: WeChat OAuth login
- **admin**: Username/password, RBAC

## APIs
| Method | Path | Description |
| :--- | :--- | :--- |
| POST | /api/auth/login | Login |
| POST | /api/auth/register | Register |
| GET | /api/auth/me | Current user info |
| POST | /api/auth/refresh | Refresh token |

## Data Models
- User: id, phone, name, role
- Session: id, userId, token, expiresAt
