# admin Analysis

## API Requirements
| Method | Path | Description |
| :--- | :--- | :--- |
| GET | /rooms | List rooms |
| POST | /rooms | Create room |
| PUT | /rooms/{id} | Update room |
| DELETE | /rooms/{id} | Delete room |
| POST | /bookings | Create booking |
| GET | /bookings | List bookings |

## Data Models
- Room: id, name, capacity, status
- Booking: id, roomId, userId, startTime, endTime
- User: id, name, email

## Tech Stack
- Backend: Spring Boot 3 + MySQL + Redis
- Frontend: Vue 3 + Element Plus
