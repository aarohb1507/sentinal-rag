# Deploying Sentinal RAG to Google Cloud Platform

This guide walks you through deploying your entire Sentinal RAG system to Google Cloud Platform using Cloud Run, Cloud SQL, and Memorystore.

## Prerequisites

- Google Cloud account with free trial credits (₹27,536)
- GCP project created (you have: `project-8f3671d7-8ffb-4a4b-ba3`)
- `gcloud` CLI installed
- OpenAI API key

## Architecture

```
┌─────────────────┐
│   Cloud Run     │
│  (sentinal-web) │  ← Next.js Frontend
└────────┬────────┘
         │
┌────────▼────────┐
│   Cloud Run     │
│  (sentinal-api) │  ← Node.js API
└────┬──────┬─────┘
     │      │
     │      └──────────┐
     │                 │
┌────▼─────┐   ┌──────▼────────┐
│Cloud SQL │   │  Memorystore  │
│(Postgres)│   │    (Redis)    │
└──────────┘   └───────────────┘
     │
┌────▼────────────┐
│   Cloud Run     │
│(sentinal-worker)│  ← Python Worker
└─────────────────┘
```

## Cost Estimation

With your ₹27,536 ($330) credits valid until May 4, 2026:

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| Cloud Run (3 services) | ₹0-500 | Free tier: 2M requests, then ~₹0.05/request |
| Cloud SQL (db-f1-micro) | ₹800-1000 | Smallest instance |
| Memorystore Redis (1GB) | ₹500-700 | Basic tier |
| Cloud Build | ₹0-200 | 120 builds/day free |
| **Total** | **₹1,300-2,400/mo** | **~11 months of runtime** |

## Quick Deploy (Automated)

### Option 1: One-Command Deployment

```bash
# Make script executable
chmod +x scripts/deploy-gcp.sh

# Run deployment
./scripts/deploy-gcp.sh
```

This will:
1. ✅ Enable required GCP APIs
2. ✅ Create Cloud SQL PostgreSQL instance
3. ✅ Create Memorystore Redis instance
4. ✅ Store secrets in Secret Manager
5. ✅ Build and deploy all 3 services to Cloud Run
6. ✅ Output all service URLs

**Time: ~15-20 minutes**

---

## Manual Deployment (Step-by-Step)

### Step 1: Set Your GCP Project

```bash
gcloud config set project project-8f3671d7-8ffb-4a4b-ba3
gcloud config set compute/region asia-south1
```

### Step 2: Enable Required APIs

```bash
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com
```

### Step 3: Create Cloud SQL Instance

```bash
# Create PostgreSQL instance
gcloud sql instances create sentinal-postgres \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=asia-south1

# Create database
gcloud sql databases create sentinal_db \
    --instance=sentinal-postgres

# Create user (replace YOUR_PASSWORD)
gcloud sql users create sentinal_user \
    --instance=sentinal-postgres \
    --password="YOUR_SECURE_PASSWORD"
```

### Step 4: Create Redis Instance

```bash
gcloud redis instances create sentinal-redis \
    --size=1 \
    --region=asia-south1 \
    --redis-version=redis_7_0

# Get Redis host IP
gcloud redis instances describe sentinal-redis \
    --region=asia-south1 \
    --format="get(host)"
```

### Step 5: Store Secrets

```bash
# OpenAI API Key
echo -n "sk-your-openai-key" | \
    gcloud secrets create openai-api-key \
    --data-file=- \
    --replication-policy="automatic"

# Database Password
echo -n "YOUR_DB_PASSWORD" | \
    gcloud secrets create db-password \
    --data-file=- \
    --replication-policy="automatic"

# JWT Secret
echo -n "your-jwt-secret" | \
    gcloud secrets create jwt-secret \
    --data-file=- \
    --replication-policy="automatic"
```

### Step 6: Deploy Services

#### Deploy API

```bash
cd packages/api

# Build and deploy
gcloud builds submit --config cloudbuild.yaml

# Set environment variables
gcloud run services update sentinal-api \
    --region=asia-south1 \
    --set-secrets=OPENAI_API_KEY=openai-api-key:latest \
    --set-secrets=JWT_SECRET=jwt-secret:latest \
    --set-env-vars="NODE_ENV=production" \
    --add-cloudsql-instances=project-8f3671d7-8ffb-4a4b-ba3:asia-south1:sentinal-postgres
```

#### Deploy Worker

```bash
cd ../worker

# Build and deploy
gcloud builds submit --config cloudbuild.yaml

# Set environment variables
gcloud run services update sentinal-worker \
    --region=asia-south1 \
    --set-secrets=OPENAI_API_KEY=openai-api-key:latest \
    --add-cloudsql-instances=project-8f3671d7-8ffb-4a4b-ba3:asia-south1:sentinal-postgres
```

#### Deploy Web

```bash
cd ../web

# Build and deploy
gcloud builds submit --config cloudbuild.yaml

# Get API URL
API_URL=$(gcloud run services describe sentinal-api --region=asia-south1 --format="get(status.url)")

# Update with API URL
gcloud run services update sentinal-web \
    --region=asia-south1 \
    --set-env-vars="NEXT_PUBLIC_API_URL=$API_URL"
```

### Step 7: Get Service URLs

```bash
# Get all URLs
gcloud run services list --region=asia-south1
```

---

## Database Migration

Run initial database migration:

```bash
# Connect to Cloud SQL
gcloud sql connect sentinal-postgres --user=sentinal_user --database=sentinal_db

# Run your migrations (or use the init script)
\i infra/postgres-init/01-init.sql
```

Or use Cloud SQL Proxy locally:

```bash
# Start proxy
./cloud_sql_proxy -instances=project-8f3671d7-8ffb-4a4b-ba3:asia-south1:sentinal-postgres=tcp:5432

# Run migrations locally
psql -h localhost -U sentinal_user -d sentinal_db -f infra/postgres-init/01-init.sql
```

---

## Environment Variables Setup

Each Cloud Run service needs environment variables:

### API Service

```bash
gcloud run services update sentinal-api --region=asia-south1 \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="PORT=8080" \
    --set-env-vars="REDIS_HOST=10.x.x.x" \
    --set-env-vars="REDIS_PORT=6379" \
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest" \
    --set-secrets="JWT_SECRET=jwt-secret:latest" \
    --set-secrets="DATABASE_URL=database-url:latest"
```

### Worker Service

```bash
gcloud run services update sentinal-worker --region=asia-south1 \
    --set-env-vars="REDIS_HOST=10.x.x.x" \
    --set-secrets="OPENAI_API_KEY=openai-api-key:latest" \
    --set-secrets="DATABASE_URL=database-url:latest"
```

---

## Monitoring & Logs

### View Logs

```bash
# API logs
gcloud run logs read sentinal-api --region=asia-south1 --limit=50

# Worker logs
gcloud run logs read sentinal-worker --region=asia-south1 --limit=50

# Web logs
gcloud run logs read sentinal-web --region=asia-south1 --limit=50
```

### Monitor Costs

```bash
# Check current usage
gcloud billing accounts list

# Set budget alerts in GCP Console:
# Billing → Budgets & alerts → Create Budget
```

---

## Testing Deployment

```bash
# Get API URL
API_URL=$(gcloud run services describe sentinal-api --region=asia-south1 --format="get(status.url)")

# Test health endpoint
curl $API_URL/health

# Get Web URL
WEB_URL=$(gcloud run services describe sentinal-web --region=asia-south1 --format="get(status.url)")

# Open in browser
open $WEB_URL
```

---

## Continuous Deployment (Optional)

### Connect to GitHub

```bash
# Install GitHub integration
gcloud builds triggers create github \
    --name="sentinal-api-trigger" \
    --repo-name="YOUR_REPO" \
    --repo-owner="YOUR_USERNAME" \
    --branch-pattern="^main$" \
    --build-config="packages/api/cloudbuild.yaml"
```

Now every push to `main` auto-deploys!

---

## Scaling Configuration

### Auto-scaling Settings

```bash
# Set auto-scaling
gcloud run services update sentinal-api --region=asia-south1 \
    --min-instances=0 \
    --max-instances=10 \
    --concurrency=80
```

### Performance Tuning

```bash
# Increase memory for better performance
gcloud run services update sentinal-api --region=asia-south1 \
    --memory=1Gi \
    --cpu=2
```

---

## Troubleshooting

### Service Not Starting

```bash
# Check logs
gcloud run logs read sentinal-api --region=asia-south1 --limit=100

# Check service details
gcloud run services describe sentinal-api --region=asia-south1
```

### Database Connection Issues

```bash
# Verify Cloud SQL connection
gcloud sql instances describe sentinal-postgres

# Test connection
gcloud sql connect sentinal-postgres --user=sentinal_user
```

### Redis Connection Issues

```bash
# Get Redis details
gcloud redis instances describe sentinal-redis --region=asia-south1

# Check VPC peering
gcloud compute networks vpc-access connectors list --region=asia-south1
```

---

## Cleanup (When Done)

```bash
# Delete Cloud Run services
gcloud run services delete sentinal-api --region=asia-south1
gcloud run services delete sentinal-web --region=asia-south1
gcloud run services delete sentinal-worker --region=asia-south1

# Delete Cloud SQL instance
gcloud sql instances delete sentinal-postgres

# Delete Redis instance
gcloud redis instances delete sentinal-redis --region=asia-south1

# Delete secrets
gcloud secrets delete openai-api-key
gcloud secrets delete db-password
gcloud secrets delete jwt-secret
```

---

## Cost Optimization Tips

1. **Use Cloud Scheduler** to pause/resume services during off-hours
2. **Set max-instances** to prevent runaway costs
3. **Enable auto-scaling** with min-instances=0
4. **Monitor billing** with budget alerts at ₹5,000, ₹10,000, ₹20,000
5. **Use db-f1-micro** (smallest) Cloud SQL tier for dev/demo

---

## Next Steps

1. ✅ Deploy using automated script
2. ✅ Set up custom domain (optional)
3. ✅ Enable Cloud CDN for static assets
4. ✅ Set up Cloud Monitoring dashboards
5. ✅ Configure backup schedules for Cloud SQL

## Support

- GCP Docs: https://cloud.google.com/run/docs
- Cloud SQL: https://cloud.google.com/sql/docs
- Memorystore: https://cloud.google.com/memorystore/docs
