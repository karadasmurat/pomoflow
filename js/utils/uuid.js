/**
 * UUID v7 Implementation (RFC 9562)
 * | 48 bits (timestamp) | 4 bits (version=7) | 12 bits (random) | 2 bits (variant=10) | 62 bits (random) |
 */
export function uuidv7() {
    const now = Date.now();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Timestamp (48 bits) - big-endian
    bytes[0] = (now / 0x10000000000) & 0xff;
    bytes[1] = (now / 0x100000000) & 0xff;
    bytes[2] = (now / 0x1000000) & 0xff;
    bytes[3] = (now / 0x10000) & 0xff;
    bytes[4] = (now / 0x100) & 0xff;
    bytes[5] = now & 0xff;

    // Version 7 (4 bits)
    bytes[6] = (bytes[6] & 0x0f) | 0x70;

    // Variant 2 (10xx) (2 bits)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return [
        bytes[0].toString(16).padStart(2, '0'),
        bytes[1].toString(16).padStart(2, '0'),
        bytes[2].toString(16).padStart(2, '0'),
        bytes[3].toString(16).padStart(2, '0'),
        '-',
        bytes[4].toString(16).padStart(2, '0'),
        bytes[5].toString(16).padStart(2, '0'),
        '-',
        bytes[6].toString(16).padStart(2, '0'),
        bytes[7].toString(16).padStart(2, '0'),
        '-',
        bytes[8].toString(16).padStart(2, '0'),
        bytes[9].toString(16).padStart(2, '0'),
        '-',
        bytes[10].toString(16).padStart(2, '0'),
        bytes[11].toString(16).padStart(2, '0'),
        bytes[12].toString(16).padStart(2, '0'),
        bytes[13].toString(16).padStart(2, '0'),
        bytes[14].toString(16).padStart(2, '0'),
        bytes[15].toString(16).padStart(2, '0'),
    ].join('');
}
