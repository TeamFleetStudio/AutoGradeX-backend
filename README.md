# AutoGradeX Backend

Fastify-based REST API for the AutoGradeX AI-powered grading assistant.

## Tech Stack

- **Framework**: Fastify 4.x
- **Database**: PostgreSQL 15
- **Authentication**: JWT (@fastify/jwt)
- **AI Integration**: OpenAI GPT-4
- **Logging**: Pino (native to Fastify)

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (installed locally)
- OpenAI API key

### Step 1: Install PostgreSQL

**Windows:**
1. Download from https://www.postgresql.org/download/windows/
2. Run installer, remember the password you set for `postgres` user
3. Default port: 5432

**Mac:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create Database

Open pgAdmin or use command line:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE autogradex;

# Exit
\q
```

### Step 3: Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values:
# - DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/autogradex
# - JWT_SECRET=your-secret-key
# - OPENAI_API_KEY=sk-your-api-key
```

### Step 4: Install & Run

```bash
# Install dependencies
npm install

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

Backend will be running at: **http://localhost:3001**

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/signup` | Register new user |
| POST | `/api/v1/auth/signin` | Login |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/auth/signout` | Logout |

### Assignments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/assignments` | Create assignment |
| GET | `/api/v1/assignments` | List assignments |
| GET | `/api/v1/assignments/:id` | Get assignment |
| PUT | `/api/v1/assignments/:id` | Update assignment |
| DELETE | `/api/v1/assignments/:id` | Delete assignment |

### Submissions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/submissions` | Submit work |
| GET | `/api/v1/submissions` | List submissions |
| GET | `/api/v1/submissions/:id` | Get submission |

### Grades
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/grades` | List grades |
| GET | `/api/v1/grades/:id` | Get grade |
| PUT | `/api/v1/grades/:id` | Override grade (instructor) |

### Rubrics
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/rubrics` | Create rubric |
| GET | `/api/v1/rubrics` | List rubrics |
| GET | `/api/v1/rubrics/templates` | List templates |
| GET | `/api/v1/rubrics/:id` | Get rubric |
| PUT | `/api/v1/rubrics/:id` | Update rubric |
| DELETE | `/api/v1/rubrics/:id` | Delete rubric |
| POST | `/api/v1/rubrics/:id/duplicate` | Duplicate rubric |

### Batch Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/batch/grade` | Grade all pending submissions |
| GET | `/api/v1/batch/status/:assignmentId` | Check grading progress |

### Export
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/export/grades/:assignmentId` | Export grades (CSV/JSON) |
| GET | `/api/v1/export/audit` | Export audit logs (admin) |
| GET | `/api/v1/export/gdpr/:userId` | GDPR data export |

### Audit
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/audit` | Query audit logs |
| GET | `/api/v1/audit/actions` | List available actions |
| GET | `/api/v1/audit/resource/:type/:id` | Resource audit history |

## Environment Variables

```bash
# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/autogradex
DB_HOST=localhost
DB_PORT=5432
DB_NAME=autogradex
DB_USER=postgres
DB_PASSWORD=password

# Security
JWT_SECRET=your-secret-key
CORS_ORIGIN=http://localhost:3000

# OpenAI
OPENAI_API_KEY=sk-your-api-key

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# File Uploads
MAX_FILE_SIZE=10485760
UPLOAD_DIR=./uploads
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Project Structure

```
backend/
├── src/
│   ├── server.js           # Entry point
│   ├── app.js              # Fastify app configuration
│   ├── plugins/
│   │   ├── database.js     # PostgreSQL connection pool
│   │   ├── auth.js         # JWT authentication
│   │   └── error-handler.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── assignments.js
│   │   ├── submissions.js
│   │   ├── grades.js
│   │   ├── rubrics.js
│   │   ├── users.js
│   │   ├── batch.js
│   │   ├── export.js
│   │   └── audit.js
│   ├── services/
│   │   ├── openai-service.js
│   │   ├── grading-service.js
│   │   ├── audit-service.js
│   │   ├── file-service.js
│   │   └── anonymization.js
│   ├── schemas/
│   │   ├── submission.js
│   │   ├── rubric.js
│   │   ├── grade.js
│   │   └── assignment.js
│   └── db/
│       ├── migrate.js
│       └── migrations/
│           └── 001_init.sql
├── tests/
│   ├── setup.js
│   ├── unit/
│   └── integration/
└── package.json
```

## API Documentation

Swagger UI available at: `http://localhost:3001/docs`

## Performance Targets

- **p95 grading latency**: < 5 seconds
- **Throughput**: 1000 grades/hour
- **Concurrent users**: 500+

## Security

- All inputs validated with JSON Schema
- Parameterized queries (SQL injection prevention)
- JWT-based authentication with role-based access
- FERPA/GDPR compliant audit logging
- Rate limiting enabled

## License

MIT
