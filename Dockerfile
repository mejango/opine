# Build the static site, then serve dist/ with Python's stdlib server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DERIVE_NETWORK=testnet
ARG VITE_WC_PROJECT_ID
ARG VITE_REFERRAL_CODE
ENV VITE_DERIVE_NETWORK=$VITE_DERIVE_NETWORK VITE_WC_PROJECT_ID=$VITE_WC_PROJECT_ID VITE_REFERRAL_CODE=$VITE_REFERRAL_CODE
RUN npm run build

FROM python:3.12-alpine
WORKDIR /srv
COPY --from=build /app/dist .
EXPOSE 8080
CMD ["python", "-m", "http.server", "8080", "--bind", "::"]
