FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto fonts-noto-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY vbs-ffmpeg-worker.js ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "vbs-ffmpeg-worker.js"]
