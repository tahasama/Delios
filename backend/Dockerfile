# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY src/Delios.Host/Delios.Host.csproj src/Delios.Host/
RUN dotnet restore src/Delios.Host/Delios.Host.csproj
COPY src/ src/
RUN dotnet publish src/Delios.Host -c Release -o /app --no-restore

# Chiseled: no shell, no package manager, runs as a non-root user.
# "extra" keeps ICU and time-zone data, needed for languages and project time zones.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080 9091
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["dotnet", "Delios.Host.dll", "healthcheck"]
ENTRYPOINT ["dotnet", "Delios.Host.dll"]
