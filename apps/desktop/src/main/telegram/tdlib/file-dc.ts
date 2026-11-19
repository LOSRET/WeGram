/**
 * The data center behind a TDLib file, read from `file.remote.id`.
 *
 * Telegram carries the DC of a profile photo in MTProto's `userProfilePhoto.dc_id`,
 * and that is the field clients use to place a user: the photo is stored on the
 * owner's DC (Pyrogram documents the same trick as "approximate"). TDLib does not
 * expose it — `profilePhoto` is only an id plus two `file`s — but it does encode
 * the remote location, `dc_id` included, in the persistent file id:
 *
 *   base64url( zeroEncode(serialize(location)) + [serialization version, id version] )
 *
 * and the serialized location starts with the `FileType` and then the DC, both
 * little-endian int32 (measured on TDLib 1.8.70: a profile photo decodes to type 1,
 * a photo to type 2, DCs 1–5).
 *
 * This is TDLib's internal format (`FileManager::from_persistent_id_v23`), not a
 * documented API, so every read is validated: the trailing version byte must be the
 * one this build writes, the file type must be a known small enum value and the DC
 * must be 1–5. Anything else answers `undefined` and the card shows 未知 instead of
 * a number it made up.
 */
const PERSISTENT_ID_VERSION = 4
const MIN_DC = 1
const MAX_DC = 5
/** `FileType` is a short enum; the flag bits sit above the mask. */
const TYPE_MASK = 0x00ffffff
const MAX_FILE_TYPE = 100

export function dcIdFromRemoteFileId(remoteId: string | undefined): number | undefined {
  if (!remoteId) return undefined
  // A web location is stored as its URL, not as a persistent id.
  if (!/^[A-Za-z0-9_-]+$/.test(remoteId)) return undefined

  const bytes = Buffer.from(remoteId, 'base64url')
  if (bytes.length < 10) return undefined
  if (bytes[bytes.length - 1] !== PERSISTENT_ID_VERSION) return undefined

  const body = zeroDecode(bytes.subarray(0, bytes.length - 2))
  if (body.length < 8) return undefined
  if ((body.readInt32LE(0) & TYPE_MASK) > MAX_FILE_TYPE) return undefined

  const dcId = body.readInt32LE(4)
  return dcId >= MIN_DC && dcId <= MAX_DC ? dcId : undefined
}

/** TDLib's run-length escaping: a run of NUL bytes is stored as `0x00, length`. */
function zeroDecode(bytes: Buffer): Buffer {
  const out: number[] = []
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0
    if (byte !== 0) {
      out.push(byte)
      continue
    }
    const count = bytes[index + 1] ?? 0
    index += 1
    for (let zero = 0; zero < count; zero += 1) out.push(0)
  }
  return Buffer.from(out)
}
