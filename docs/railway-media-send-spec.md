# Spec: Add native media (document/image) support to `/api/send`

**Service:** `whatsapp-agent-production-3525.up.railway.app`
**Endpoint:** `POST /api/send`
**Goal:** Deliver PDFs/images as **native WhatsApp attachments** (a tappable file card),
not as a text message containing a link.

---

## Current behaviour

The endpoint accepts a JSON body and sends a **text** message. It currently
**requires** `phone` and one of `message` / `template_name`, and ignores any media
fields. Result: files arrive as a plain URL in the chat text.

## What the CRM already sends

The CRM (`/api/wa-media`) already POSTs this JSON when a file is attached. **No CRM
change is needed** — you only need to read these fields and send native media:

```json
{
  "phone": "918587044276",
  "name": "918587044276",
  "message": "optional caption typed by the agent\n\n📎 *Krishna Aura - Cost Sheet.pdf*\nhttps://<public-url>.pdf",
  "caption": "optional caption typed by the agent",
  "call_id": "uuid",
  "campaign": "Manual",

  "media_url":    "https://joshnpdtwghirtpvcdcb.supabase.co/storage/v1/object/public/media/broadcasts/xxxx.pdf",
  "document_url": "https://...same url... (present only for non-image files)",
  "media_type":   "document",            // or "image"
  "type":         "document",            // duplicate of media_type
  "mimetype":     "application/pdf",
  "mime_type":    "application/pdf",      // duplicate
  "filename":     "Krishna Aura - Cost Sheet.pdf",
  "file_name":    "Krishna Aura - Cost Sheet.pdf"  // duplicate
}
```

- `media_url` is a **public, directly-downloadable** URL (Supabase public bucket).
- `media_type` is `"document"` for PDFs/docs and `"image"` for images.
- `filename` is the original file name to show on the attachment card.
- `caption` is the clean text to show under the media (the `message` field still
  contains the same text plus the URL — see "Backward compatibility").

## Required change

When `media_url` is present, send the file as **native media** instead of (or in
addition to) the text message. Pick the branch by `media_type`.

### If using whatsapp-web.js
```js
const { MessageMedia } = require('whatsapp-web.js')

if (body.media_url) {
  const media = await MessageMedia.fromUrl(body.media_url, { unsafeMime: true })
  if (body.filename) media.filename = body.filename   // shows on the document card
  await client.sendMessage(chatId, media, {
    caption: body.caption || '',
    sendMediaAsDocument: body.media_type === 'document', // force document card for PDFs
  })
} else {
  await client.sendMessage(chatId, body.message)        // existing text path
}
```

### If using Baileys
```js
if (body.media_url) {
  if (body.media_type === 'image') {
    await sock.sendMessage(jid, { image: { url: body.media_url }, caption: body.caption || '' })
  } else {
    await sock.sendMessage(jid, {
      document: { url: body.media_url },
      mimetype: body.mimetype || 'application/pdf',
      fileName: body.filename || 'document.pdf',
      caption: body.caption || '',
    })
  }
} else {
  await sock.sendMessage(jid, { text: body.message })   // existing text path
}
```

### If using the Meta WhatsApp Cloud API
```jsonc
// POST https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/messages
{
  "messaging_product": "whatsapp",
  "to": "918587044276",
  "type": "document",                  // or "image"
  "document": {
    "link": "<media_url>",
    "filename": "Krishna Aura - Cost Sheet.pdf",
    "caption": "<caption>"
  }
}
```
> Note: for the Cloud API, free-form (non-template) media messages are only allowed
> inside the 24-hour customer-service window. Outside it, a media **template** is required.

## Validation change

Relax the current check so a request with `media_url` is valid even without
`message`/`template_name`:

```js
const hasText  = body.message || body.template_name
const hasMedia = body.media_url
if (!body.phone || (!hasText && !hasMedia)) {
  return res.status(400).json({ error: "phone and (message, template_name, or media_url) required" })
}
```

## Backward compatibility

The CRM still puts the file URL inside `message` as a fallback. Once native media
works, you can optionally **strip the trailing URL** from `message` when `media_url`
is present, so the caption stays clean:

```js
let caption = body.caption || body.message || ''
// caption already excludes the URL via the `caption` field — prefer it
```

## Test checklist

1. Send a PDF → arrives as a **document card** with the correct filename, openable in-app.
2. Send a JP/PNG → arrives as a **photo**, not a link.
3. Send text only (no `media_url`) → still works exactly as before.
4. Send a file with a typed caption → caption shows under the attachment.
