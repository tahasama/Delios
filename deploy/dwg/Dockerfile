# DWG → DXF for the Preview (docs/gaps/previews.md, the free route): LibreDWG's dwg2dxf behind a small HTTP service.
# LibreDWG is GPL and runs here as its own program, apart from the app. openSUSE ships it ready made (libredwg-tools),
# so nothing is compiled. Its reading of a drawing depends on the DWG version and content; what it cannot read is said,
# and the file is downloaded instead.
FROM opensuse/leap:15.6
RUN zypper --non-interactive install --no-recommends libredwg-tools python3 \
 && zypper clean --all \
 && command -v dwg2dxf
COPY server.py /app/server.py
# Not root: the unprivileged id, which needs no entry in the image's list of users.
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"]
CMD ["python3", "/app/server.py"]
