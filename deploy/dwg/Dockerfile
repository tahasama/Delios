# DWG → DXF for the Preview (docs/gaps/previews.md, the free route): LibreDWG's dwg2dxf behind a small HTTP service.
# LibreDWG is GPL and runs here as its own program, apart from the app. Its reading of a drawing depends on the DWG
# version and content; what it cannot read is said, and the file is downloaded instead.
FROM debian:bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config wget xz-utils ca-certificates texinfo \
 && rm -rf /var/lib/apt/lists/*
ARG LIBREDWG=0.13.3
WORKDIR /src
RUN wget -q "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG}/libredwg-${LIBREDWG}.tar.xz" \
 && tar xf "libredwg-${LIBREDWG}.tar.xz" \
 && cd "libredwg-${LIBREDWG}" \
 && ./configure --prefix=/opt/libredwg --disable-bindings \
 && make -j"$(nproc)" \
 && make install

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/libredwg /opt/libredwg
ENV PATH=/opt/libredwg/bin:$PATH LD_LIBRARY_PATH=/opt/libredwg/lib
COPY server.py /app/server.py
USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"]
CMD ["python3", "/app/server.py"]
