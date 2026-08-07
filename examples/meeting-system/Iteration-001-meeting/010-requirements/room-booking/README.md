# Room Booking

## Overview
Meeting room CRUD + booking with conflict detection.

## Platforms affected
- **app**: Room list, quick book
- **h5**: Room list, booking calendar
- **admin**: Room management, booking approvals

## APIs
| Method | Path | Description |
| :--- | :--- | :--- |
| GET | /api/rooms | List rooms |
| POST | /api/rooms | Create room |
| PUT | /api/rooms/:id | Update room |
| DELETE | /api/rooms/:id | Delete room |
| POST | /api/bookings | Create booking |
| GET | /api/bookings | List bookings |

## Data Models
- Room: id, name, capacity, floor, status
- Booking: id, roomId, userId, startTime, endTime
