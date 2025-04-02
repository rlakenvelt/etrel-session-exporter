ARG DOCKER_HUB="docker.io"
ARG NODE_VERSION="18.20-alpine"
ARG NPM_REGISTRY=" https://registry.npmjs.org"

FROM $DOCKER_HUB/library/node:$NODE_VERSION 

COPY . /app/

RUN cd /app/                                                           && \
    npm install 

EXPOSE 3000

CMD [ "node", "/app/server.js" ]


