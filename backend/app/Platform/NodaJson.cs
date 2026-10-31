using System.Text.Json;
using System.Text.Json.Serialization;
using NodaTime;
using NodaTime.Text;

namespace Delios.Host.Platform;

/// <summary>
/// NodaTime's moments and days in every answer and request, as ISO text ("2026-10-28T12:00:00Z", "2026-10-28"):
/// without them, a moment went out as an empty object and could not be read back.
/// </summary>
public static class NodaJson
{
    public static void Add(IList<JsonConverter> converters)
    {
        converters.Add(new InstantConverter());
        converters.Add(new LocalDateConverter());
    }

    private sealed class InstantConverter : JsonConverter<Instant>
    {
        public override Instant Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var text = reader.GetString() ?? "";
            var parsed = InstantPattern.ExtendedIso.Parse(text);
            if (parsed.Success) return parsed.Value;
            return DateTimeOffset.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var dto)
                ? Instant.FromDateTimeOffset(dto)
                : throw new JsonException($"Not a moment: {text}");
        }

        public override void Write(Utf8JsonWriter writer, Instant value, JsonSerializerOptions options) =>
            writer.WriteStringValue(InstantPattern.ExtendedIso.Format(value));
    }

    private sealed class LocalDateConverter : JsonConverter<LocalDate>
    {
        public override LocalDate Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var text = reader.GetString() ?? "";
            var parsed = LocalDatePattern.Iso.Parse(text.Length > 10 ? text[..10] : text);
            return parsed.Success ? parsed.Value : throw new JsonException($"Not a day: {text}");
        }

        public override void Write(Utf8JsonWriter writer, LocalDate value, JsonSerializerOptions options) =>
            writer.WriteStringValue(LocalDatePattern.Iso.Format(value));
    }
}
