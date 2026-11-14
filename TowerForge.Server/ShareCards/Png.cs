using System.Buffers.Binary;
using System.IO.Compression;

namespace TowerForge.Server.ShareCards;

// ============================================================
//  PNG in and out, for the share-link preview cards: reads the two
//  pictures scripts/share-card.ps1 draws (8-bit RGB or RGBA, not
//  interlaced — what System.Drawing writes) and writes the finished
//  card as 8-bit RGB. Our own few lines rather than a drawing library
//  with native parts (PNG: RFC 2083; zlib: .NET's ZLibStream).
// ============================================================
public static class Png
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    // An 8-bit RGB picture: three bytes a pixel, rows top to bottom.
    public sealed record Image(int Width, int Height, byte[] Rgb);

    public static Image Decode(byte[] png)
    {
        if (png.Length < 8 || !png.AsSpan(0, 8).SequenceEqual(Signature)) throw new InvalidDataException("Not a PNG.");
        int width = 0, height = 0, colorType = -1;
        using var idat = new MemoryStream();
        for (int at = 8; at + 8 <= png.Length;)
        {
            int length = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(at));
            var type = System.Text.Encoding.ASCII.GetString(png, at + 4, 4);
            var data = png.AsSpan(at + 8, length);
            if (type == "IHDR")
            {
                width = BinaryPrimitives.ReadInt32BigEndian(data);
                height = BinaryPrimitives.ReadInt32BigEndian(data[4..]);
                colorType = data[9];
                if (data[8] != 8 || (colorType != 2 && colorType != 6) || data[12] != 0)
                    throw new InvalidDataException("Only 8-bit RGB or RGBA PNGs without interlacing.");
            }
            else if (type == "IDAT") idat.Write(data);
            else if (type == "IEND") break;
            at += 12 + length;
        }
        if (width <= 0 || height <= 0) throw new InvalidDataException("No PNG header.");

        int bpp = colorType == 6 ? 4 : 3, stride = width * bpp;
        var raw = new byte[height * (stride + 1)];
        idat.Position = 0;
        using (var z = new ZLibStream(idat, CompressionMode.Decompress)) z.ReadExactly(raw);

        var pixels = new byte[height * stride];
        for (int y = 0; y < height; y++)
        {
            byte filter = raw[y * (stride + 1)];
            var line = raw.AsSpan(y * (stride + 1) + 1, stride);
            var row = pixels.AsSpan(y * stride, stride);
            var up = y > 0 ? pixels.AsSpan((y - 1) * stride, stride) : default;
            for (int i = 0; i < stride; i++)
            {
                int a = i >= bpp ? row[i - bpp] : 0, b = y > 0 ? up[i] : 0, c = i >= bpp && y > 0 ? up[i - bpp] : 0;
                row[i] = (byte)(line[i] + filter switch
                {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => (a + b) / 2,
                    4 => Paeth(a, b, c),
                    _ => throw new InvalidDataException("Unknown PNG filter."),
                });
            }
        }
        if (bpp == 3) return new Image(width, height, pixels);
        // RGBA: over black (the sheets are opaque anyway).
        var rgb = new byte[width * height * 3];
        for (int p = 0; p < width * height; p++)
            for (int ch = 0; ch < 3; ch++) rgb[p * 3 + ch] = (byte)(pixels[p * 4 + ch] * pixels[p * 4 + 3] / 255);
        return new Image(width, height, rgb);
    }

    public static byte[] Encode(Image img)
    {
        int stride = img.Width * 3;
        var filtered = new byte[img.Height * (stride + 1)];
        var trial = new byte[stride];
        for (int y = 0; y < img.Height; y++)
        {
            var row = img.Rgb.AsSpan(y * stride, stride);
            var up = y > 0 ? img.Rgb.AsSpan((y - 1) * stride, stride) : default;
            // Each row with the filter that leaves the smallest numbers (the usual guess at what packs best).
            long bestScore = long.MaxValue;
            for (int f = 0; f <= 4; f++)
            {
                long score = 0;
                for (int i = 0; i < stride; i++)
                {
                    int a = i >= 3 ? row[i - 3] : 0, b = y > 0 ? up[i] : 0, c = i >= 3 && y > 0 ? up[i - 3] : 0;
                    byte v = (byte)(row[i] - f switch { 0 => 0, 1 => a, 2 => b, 3 => (a + b) / 2, _ => Paeth(a, b, c) });
                    trial[i] = v;
                    int sv = (sbyte)v;
                    score += sv < 0 ? -sv : sv;
                }
                if (score < bestScore)
                {
                    bestScore = score;
                    filtered[y * (stride + 1)] = (byte)f;
                    trial.CopyTo(filtered.AsSpan(y * (stride + 1) + 1));
                }
            }
        }

        using var compressed = new MemoryStream();
        using (var z = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true)) z.Write(filtered);

        using var outStream = new MemoryStream();
        outStream.Write(Signature);
        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, img.Width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), img.Height);
        header[8] = 8;   // bit depth
        header[9] = 2;   // RGB
        WriteChunk(outStream, "IHDR", header);
        WriteChunk(outStream, "IDAT", compressed.ToArray());
        WriteChunk(outStream, "IEND", []);
        return outStream.ToArray();
    }

    private static int Paeth(int a, int b, int c)
    {
        int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }

    private static void WriteChunk(Stream s, string type, byte[] data)
    {
        Span<byte> four = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(four, data.Length);
        s.Write(four);
        var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
        s.Write(typeBytes);
        s.Write(data);
        uint crc = Crc32(typeBytes, 0xFFFFFFFFu);
        crc = Crc32(data, crc) ^ 0xFFFFFFFFu;
        BinaryPrimitives.WriteUInt32BigEndian(four, crc);
        s.Write(four);
    }

    private static readonly uint[] CrcTable = MakeCrcTable();

    private static uint[] MakeCrcTable()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        return t;
    }

    private static uint Crc32(ReadOnlySpan<byte> data, uint crc)
    {
        foreach (var b in data) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc;
    }
}
