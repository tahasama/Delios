using System.IO.Compression;
using Docnet.Core;
using Docnet.Core.Models;

namespace Delios.Host.Reviews;

/// <summary>
/// Where the stamp goes on a page (owner: the usual corner may be filled, and the stamp stays the app's): each page is
/// looked at as a picture (PDFium, read only) and the stamp put on the first clear spot: the chosen corner, then the
/// others, then along the edges; a step smaller when there is none, down to S; still none, where the least is drawn.
/// The stamp always stays on its page. Nothing here changes a file; the stamp is drawn by <see cref="Stamping.Stamp"/>.
/// </summary>
public static class StampPlacement
{
    /// <summary>The page drawn at half scale: one pixel is two points, fine enough to find room for a stamp.</summary>
    private const double Scaling = 0.5;
    /// <summary>Away from the page's edge, in points, as the stamp always sat.</summary>
    public const double Margin = 18;
    /// <summary>Around the stamp, kept clear too, in points.</summary>
    private const double Breathing = 4;

    /// <summary>One page as ink and paper: where something is drawn, counted so any rectangle is read at once.</summary>
    public sealed class Ink
    {
        private readonly int[,] _sum;
        public int Width { get; }
        public int Height { get; }

        public Ink(byte[] bgra, int width, int height)
        {
            Width = width;
            Height = height;
            _sum = new int[height + 1, width + 1];
            for (var y = 0; y < height; y++)
            {
                var row = 0;
                for (var x = 0; x < width; x++)
                {
                    var i = (y * width + x) * 4;
                    // Transparent is paper; anything darker than a faint tint is ink.
                    var alpha = bgra[i + 3];
                    var light = (bgra[i] * 114 + bgra[i + 1] * 587 + bgra[i + 2] * 299) / 1000;
                    var drawn = alpha > 24 && light < 235;
                    row += drawn ? 1 : 0;
                    _sum[y + 1, x + 1] = _sum[y, x + 1] + row;
                }
            }
        }

        /// <summary>How much of a rectangle (in points from the top left) is ink, 0 to 1.</summary>
        public double Inked(double x, double y, double w, double h)
        {
            int x0 = Math.Clamp((int)Math.Floor(x * Scaling), 0, Width), y0 = Math.Clamp((int)Math.Floor(y * Scaling), 0, Height);
            int x1 = Math.Clamp((int)Math.Ceiling((x + w) * Scaling), 0, Width), y1 = Math.Clamp((int)Math.Ceiling((y + h) * Scaling), 0, Height);
            var area = (x1 - x0) * (y1 - y0);
            if (area <= 0) return 1;
            var ink = _sum[y1, x1] - _sum[y0, x1] - _sum[y1, x0] + _sum[y0, x0];
            return (double)ink / area;
        }
    }

    /// <summary>Every page's ink, in order; null for a page PDFium could not draw (it then keeps the chosen corner).</summary>
    public static List<Ink?> Read(byte[] pdf)
    {
        var pages = new List<Ink?>();
        using var reader = DocLib.Instance.GetDocReader(pdf, new PageDimensions(Scaling));
        for (var i = 0; i < reader.GetPageCount(); i++)
        {
            try
            {
                using var page = reader.GetPageReader(i);
                pages.Add(new Ink(page.GetImage(), page.GetPageWidth(), page.GetPageHeight()));
            }
            catch (Exception)
            {
                pages.Add(null);
            }
        }
        return pages;
    }

    /// <summary>
    /// The first clear spot for a box of <paramref name="w"/> × <paramref name="h"/> points on a page of
    /// <paramref name="pageW"/> × <paramref name="pageH"/>: the chosen corner, then the corner beside it, the one under
    /// it, the opposite one, then every place along the edges, nearest the chosen corner first. Null: no room anywhere.
    /// </summary>
    public static (double X, double Y)? Find(Ink ink, double pageW, double pageH, double w, double h, string place)
    {
        if (pageW - w - 2 * Margin < 0 || pageH - h - 2 * Margin < 0) return null;
        foreach (var (x, y) in Candidates(pageW, pageH, w, h, place))
        {
            // Clear: next to nothing drawn there, the stamp's surroundings included (a speck of dust is not a drawing).
            if (ink.Inked(x - Breathing, y - Breathing, w + 2 * Breathing, h + 2 * Breathing) <= 0.002) return (x, y);
        }
        return null;
    }

    /// <summary>The places tried, in order: the chosen corner, the others, then along the edges nearest it first.</summary>
    private static List<(double X, double Y)> Candidates(double pageW, double pageH, double w, double h, string place)
    {
        double left = Margin, right = pageW - w - Margin, top = Margin, bottom = pageH - h - Margin;
        if (right < left || bottom < top) return [(Math.Max(0, (pageW - w) / 2), Math.Max(0, (pageH - h) / 2))];
        var startX = place.EndsWith("LEFT") ? left : right;
        var startY = place.StartsWith("BOTTOM") ? bottom : top;
        var otherX = startX == left ? right : left;
        var otherY = startY == top ? bottom : top;
        var candidates = new List<(double X, double Y)> { (startX, startY), (otherX, startY), (startX, otherY), (otherX, otherY) };
        const double step = 12;
        var along = new List<(double X, double Y)>();
        for (var x = left; x <= right; x += step) { along.Add((x, top)); along.Add((x, bottom)); }
        for (var y = top; y <= bottom; y += step) { along.Add((left, y)); along.Add((right, y)); }
        candidates.AddRange(along.OrderBy(p => Math.Abs(p.X - startX) + Math.Abs(p.Y - startY)));
        return candidates;
    }

    /// <summary>The smallest the app makes a stamp to find room for it: the stamp card's S.</summary>
    public const double Smallest = 0.8;

    /// <summary>
    /// Where the stamp goes on a page, and at what size (owner: "the stamp would definitely find a room", never a page of
    /// its own): the first clear spot at the project's size; none, the same search a step smaller each time down to S;
    /// still none, the spot with the least drawing under it, at S (its white ground keeps it readable).
    /// </summary>
    public static (double X, double Y, double Scale) Choose(Ink ink, double pageW, double pageH, double baseW, double baseH, double scale, string place)
    {
        var tried = scale;
        while (true)
        {
            if (Find(ink, pageW, pageH, baseW * tried, baseH * tried, place) is { } clear) return (clear.X, clear.Y, tried);
            if (tried <= Smallest) break;
            tried = Math.Max(Smallest, Math.Round(tried * 0.9, 3));
        }
        var small = Math.Min(scale, Smallest);
        var best = Candidates(pageW, pageH, baseW * small, baseH * small, place)
            .MinBy(c => ink.Inked(c.X, c.Y, baseW * small, baseH * small));
        return (best.X, best.Y, small);
    }

    /// <summary>The first page as a PNG picture, for placing the stamp by hand; null if it cannot be drawn.</summary>
    public static (byte[] Png, int Width, int Height)? FirstPage(byte[] pdf, double scaling = 1)
    {
        using var reader = DocLib.Instance.GetDocReader(pdf, new PageDimensions(scaling));
        if (reader.GetPageCount() == 0) return null;
        using var page = reader.GetPageReader(0);
        var bgra = page.GetImage();
        int w = page.GetPageWidth(), h = page.GetPageHeight();
        return (Png(bgra, w, h), w, h);
    }

    /// <summary>A PNG of BGRA pixels on white paper (transparent drawn white).</summary>
    private static byte[] Png(byte[] bgra, int w, int h)
    {
        var raw = new byte[h * (w * 3 + 1)];
        for (var y = 0; y < h; y++)
        {
            var o = y * (w * 3 + 1);
            raw[o++] = 0;
            for (var x = 0; x < w; x++)
            {
                var i = (y * w + x) * 4;
                var a = bgra[i + 3] / 255.0;
                raw[o++] = (byte)(bgra[i + 2] * a + 255 * (1 - a));
                raw[o++] = (byte)(bgra[i + 1] * a + 255 * (1 - a));
                raw[o++] = (byte)(bgra[i] * a + 255 * (1 - a));
            }
        }
        using var output = new MemoryStream();
        output.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        var header = new byte[13];
        WriteInt(header, 0, w);
        WriteInt(header, 4, h);
        header[8] = 8; header[9] = 2;
        Chunk(output, "IHDR", header);
        using (var packed = new MemoryStream())
        {
            using (var z = new ZLibStream(packed, CompressionLevel.Fastest, true)) z.Write(raw);
            Chunk(output, "IDAT", packed.ToArray());
        }
        Chunk(output, "IEND", []);
        return output.ToArray();
    }

    private static void WriteInt(byte[] into, int at, int value)
    {
        into[at] = (byte)(value >> 24); into[at + 1] = (byte)(value >> 16); into[at + 2] = (byte)(value >> 8); into[at + 3] = (byte)value;
    }

    private static void Chunk(Stream output, string type, byte[] data)
    {
        var length = new byte[4];
        WriteInt(length, 0, data.Length);
        output.Write(length);
        var typed = new byte[4 + data.Length];
        System.Text.Encoding.ASCII.GetBytes(type).CopyTo(typed, 0);
        data.CopyTo(typed, 4);
        output.Write(typed);
        var crc = new byte[4];
        WriteInt(crc, 0, (int)System.IO.Hashing.Crc32.HashToUInt32(typed));
        output.Write(crc);
    }
}
