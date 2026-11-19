FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY nas/viabilidad/package.json ./nas/viabilidad/package.json
RUN cd nas/viabilidad && npm install --omit=dev --no-fund --no-audit
COPY . .
ENV NODE_ENV=production FACTIUN_MAPA_DATA=/data PORT=8787
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser
EXPOSE 8787
CMD ["node","nas/viabilidad/service.mjs"]
