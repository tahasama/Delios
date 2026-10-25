# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY app/Delios.Host.csproj app/
RUN dotnet restore app/Delios.Host.csproj
COPY app/ app/
RUN dotnet publish app -c Release -o /out --no-restore

# Chiseled: no shell, no package manager, runs as a non-root user.
# "extra" keeps ICU and time-zone data, needed for languages and project time zones.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra
WORKDIR /app
COPY --from=build /out .
EXPOSE 8080 9091
# Each check starts the app once more to ask it: often while starting, then every 5 minutes.
HEALTHCHECK --interval=5m --timeout=10s --start-period=60s --start-interval=3s --retries=3 \
  CMD ["dotnet", "Delios.Host.dll", "healthcheck"]
ENTRYPOINT ["dotnet", "Delios.Host.dll"]
