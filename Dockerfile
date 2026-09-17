# Build the static site, then serve it (plus per-link unfurl images) with a small Node server.
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

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ARG VITE_DERIVE_NETWORK=testnet
ENV VITE_DERIVE_NETWORK=$VITE_DERIVE_NETWORK
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/@resvg ./node_modules/@resvg
COPY server ./server
EXPOSE 8080
CMD ["node", "server/index.mjs"]
