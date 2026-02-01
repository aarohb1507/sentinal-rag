#!/bin/bash

# GCP Deployment Script for Sentinal RAG
# This script sets up all infrastructure on Google Cloud Platform

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Sentinal RAG - GCP Deployment${NC}"
echo -e "${BLUE}======================================${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${YELLOW}gcloud CLI not found. Installing...${NC}"
    curl https://sdk.cloud.google.com | bash
    exec -l $SHELL
fi

# Get project ID
PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}No project set. Please set your GCP project:${NC}"
    echo "gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo -e "${GREEN}Using project: $PROJECT_ID${NC}\n"

# Enable required APIs
echo -e "${BLUE}Step 1: Enabling required GCP APIs...${NC}"
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    cloudscheduler.googleapis.com

echo -e "${GREEN}✓ APIs enabled${NC}\n"

# Create Cloud SQL instance
echo -e "${BLUE}Step 2: Creating Cloud SQL PostgreSQL instance...${NC}"
if gcloud sql instances describe sentinal-postgres 2>/dev/null; then
    echo -e "${YELLOW}Cloud SQL instance already exists${NC}"
else
    gcloud sql instances create sentinal-postgres \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=asia-south1 \
        --network=default \
        --allocated-ip-range-name=google-managed-services-default \
        --no-assign-ip
    
    echo -e "${GREEN}✓ Cloud SQL instance created${NC}"
fi

# Create database
echo -e "${BLUE}Creating database...${NC}"
gcloud sql databases create sentinal_db --instance=sentinal-postgres || echo "Database may already exist"

# Create database user
echo -e "${BLUE}Creating database user...${NC}"
DB_PASSWORD=$(openssl rand -base64 32)
gcloud sql users create sentinal_user \
    --instance=sentinal-postgres \
    --password="$DB_PASSWORD" || echo "User may already exist"

echo -e "${GREEN}✓ Database configured${NC}\n"

# Create Memorystore Redis instance
echo -e "${BLUE}Step 3: Creating Memorystore Redis instance...${NC}"
if gcloud redis instances describe sentinal-redis --region=asia-south1 2>/dev/null; then
    echo -e "${YELLOW}Redis instance already exists${NC}"
else
    gcloud redis instances create sentinal-redis \
        --size=1 \
        --region=asia-south1 \
        --redis-version=redis_7_0 \
        --tier=basic
    
    echo -e "${GREEN}✓ Redis instance created${NC}"
fi

# Get Redis host
REDIS_HOST=$(gcloud redis instances describe sentinal-redis --region=asia-south1 --format="get(host)")
echo -e "${GREEN}Redis host: $REDIS_HOST${NC}\n"

# Store secrets in Secret Manager
echo -e "${BLUE}Step 4: Storing secrets in Secret Manager...${NC}"

# OpenAI API Key
read -p "Enter your OpenAI API Key: " OPENAI_KEY
echo -n "$OPENAI_KEY" | gcloud secrets create openai-api-key --data-file=- --replication-policy="automatic" || \
    echo -n "$OPENAI_KEY" | gcloud secrets versions add openai-api-key --data-file=-

# Database password
echo -n "$DB_PASSWORD" | gcloud secrets create db-password --data-file=- --replication-policy="automatic" || \
    echo -n "$DB_PASSWORD" | gcloud secrets versions add db-password --data-file=-

# JWT Secret
JWT_SECRET=$(openssl rand -base64 32)
echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret --data-file=- --replication-policy="automatic" || \
    echo -n "$JWT_SECRET" | gcloud secrets versions add jwt-secret --data-file=-

echo -e "${GREEN}✓ Secrets stored${NC}\n"

# Build and deploy services
echo -e "${BLUE}Step 5: Building and deploying services...${NC}"

# Deploy API
echo -e "${BLUE}Deploying API service...${NC}"
cd packages/api
gcloud builds submit --config cloudbuild.yaml
cd ../..

# Deploy Worker
echo -e "${BLUE}Deploying Worker service...${NC}"
cd packages/worker
gcloud builds submit --config cloudbuild.yaml
cd ../..

# Deploy Web
echo -e "${BLUE}Deploying Web service...${NC}"
cd packages/web
gcloud builds submit --config cloudbuild.yaml
cd ../..

echo -e "${GREEN}✓ All services deployed${NC}\n"

# Get service URLs
API_URL=$(gcloud run services describe sentinal-api --region=asia-south1 --format="get(status.url)")
WEB_URL=$(gcloud run services describe sentinal-web --region=asia-south1 --format="get(status.url)")
WORKER_URL=$(gcloud run services describe sentinal-worker --region=asia-south1 --format="get(status.url)")

# Print summary
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${BLUE}======================================${NC}\n"

echo -e "${GREEN}Service URLs:${NC}"
echo -e "  API:    $API_URL"
echo -e "  Web:    $WEB_URL"
echo -e "  Worker: $WORKER_URL\n"

echo -e "${GREEN}Database:${NC}"
echo -e "  Instance: sentinal-postgres"
echo -e "  Database: sentinal_db"
echo -e "  User:     sentinal_user\n"

echo -e "${GREEN}Redis:${NC}"
echo -e "  Host: $REDIS_HOST"
echo -e "  Port: 6379\n"

echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Visit your web app: $WEB_URL"
echo -e "2. Test your API: $API_URL/health"
echo -e "3. Check logs: gcloud run logs read sentinal-api --region=asia-south1\n"

echo -e "${BLUE}======================================${NC}"
