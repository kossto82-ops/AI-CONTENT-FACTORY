# TECH STACK — Recommended Stack & Alternatives

## 1. Current Stack (Confirmed)

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Language | TypeScript | 5.x | Type safety, stack consistency, existing codebase |
| Runtime | Node.js | 26 | LTS, built-in SQLite, modern APIs |
| Backend | node:http (built-in) | — | Zero dependencies, already working |
| Database | SQLite (node:sqlite) | Built-in | Zero-ops, WAL, transactions, single file |
| Frontend | Vite + React 19 | Latest | Fast HMR, no SSR complexity |
| Styling | Tailwind CSS v4 | Latest | CSS-first, no config file |
| AI Gateway | OmniRoute | Local | Provider independence, 400+ models, task routing |
| Package Manager | npm | — | Already working |

## 2. Stack for Each Phase

### Phase 3-4: Brain-First Agents (Research + Script + Director + QA)
No new dependencies. Everything runs on the existing stack.

| Need | Solution | Dependency |
|------|----------|------------|
| Better prompts | Template files (Markdown/JSON) | None |
| Richer schemas | Zod (already used) | None |
| CLI improvements | node:readline (built-in) | None |

### Phase 5: Visual Agent
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| Image generation | OmniRoute (FLUX/Imagen) | Already connected | $0.02-0.05/image |
| Stock images | Pexels API | `pexels` npm package or HTTP | Free (API key) |
| Image processing | Sharp | `sharp` npm package | Free |
| Embeddings | OmniRoute (bge-m3) | Already connected | $0.0001/embedding |
| Asset library | SQLite (already have) | None | Free |

**Alternative for image processing:** Jimp (pure JS, no native deps) if Sharp's native compilation is problematic on Windows.

### Phase 6: Voice Agent
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| TTS (free) | Edge TTS | Python subprocess (edge-tts) | Free |
| TTS (premium) | OmniRoute (OpenAI/ElevenLabs) | Already connected | $0.01-0.05/1K chars |
| Word timestamps | faster-whisper | Python subprocess | Free (local) |
| Word timestamps (alt) | OpenAI Whisper API | OmniRoute or direct | $0.006/min |
| Audio processing | FFmpeg | System install | Free |

**Windows note:** Edge TTS requires Python installed. We already have Python 3.14. The subprocess call is simple:
```
edge-tts --voice en-US-AndrewNeural --file input.txt --write-media output.mp3 --write-subtitles output.vtt
```

**Alternative:** If Python dependency is unacceptable, OpenAI TTS via OmniRoute is equally good but costs ~$0.01/short.

### Phase 7: Assembly Agent
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| Video composition | FFmpeg | System install (NOT installed yet) | Free |
| Ken Burns | FFmpeg zoompan filter | Part of FFmpeg | Free |
| Subtitle burn-in | FFmpeg ass/subtitles filter | Part of FFmpeg | Free |
| Audio mixing | FFmpeg amix filter | Part of FFmpeg | Free |
| Music ducking | FFmpeg sidechaincompress | Part of FFmpeg | Free |

**FFmpeg installation on Windows:**
```powershell
winget install -e --id Gyan.FFmpeg
# OR download from https://ffmpeg.org/download.html
```

**Alternative:** If FFmpeg compilation issues arise, Node's `fluent-ffmpeg` wrapper simplifies the API but still requires FFmpeg binary.

### Phase 8: QA Agent (Vision)
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| Image understanding | OmniRoute (vision models) | Already connected | $0.001-0.01/review |
| Video frame analysis | FFmpeg frame extraction + vision | FFmpeg + OmniRoute | Minimal |
| Audio analysis | FFmpeg loudness/level analysis | FFmpeg | Free |
| Duration/resolution checks | FFprobe | Part of FFmpeg | Free |

### Phase 9: Publisher Agent
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| YouTube upload | YouTube Data API v3 | `googleapis` npm or HTTP | Free (quota) |
| Thumbnail generation | Sharp + canvas | `sharp` + `@napi-rs/canvas` | Free |
| Metadata formatting | Pure TypeScript | None | Free |
| Social media copy | OmniRoute (text gen) | Already connected | Minimal |

### Phase 10-11: Analytics + Learning
| Need | Solution | Dependency | Cost |
|------|----------|------------|------|
| Analytics aggregation | SQLite queries | None | Free |
| Embeddings (semantic memory) | OmniRoute (bge-m3) | Already connected | $0.0001/embedding |
| Trend analysis | OmniRoute (text gen) | Already connected | Minimal |

## 3. Dependencies NOT Needed

| Technology | Why NOT |
|------------|---------|
| Docker | Local single-process, no containerization needed |
| PostgreSQL | SQLite sufficient for control-plane state |
| Redis | In-process events sufficient for MVP |
| Kafka/RabbitMQ | No multi-service communication needed |
| Kubernetes | Single-machine, no orchestration |
| Python backend | Our AI calls go through OmniRoute HTTP, not Python SDKs |
| Express/Fastify | node:http already working, no middleware needed |
| Prisma/TypeORM | Thin repository layer is simpler than ORM |
| Webpack | Vite handles bundling |
| Babel | Node 26 supports modern JS natively |
| TensorFlow/PyTorch | No local ML inference; OmniRoute handles routing |
| Remotion | Defer to Phase 7+ if needed for animated sections |

## 4. Dependencies to Add (Phase 5+)

### Phase 5: Image + Asset Library
```json
{
  "pexels": "^1.x",
  "sharp": "^0.33.x"
}
```
OR (if Sharp native deps are problematic):
```json
{
  "jimp": "^1.x"
}
```

### Phase 6: Voice
```json
// No npm packages needed — Python subprocess for Edge TTS + faster-whisper
// Already have Python 3.14 in environment
```

### Phase 7: Assembly
```json
{
  "fluent-ffmpeg": "^2.x"
}
```
Requires: `ffmpeg` binary on PATH (winget install)

### Phase 9: Publishing
```json
{
  "googleapis": "^140.x"
}
```

## 5. Python Dependency Strategy

The audited repos are all Python. Our backend is TypeScript. We have two options:

### Option A: Python Subprocess (Recommended)
- Call Python scripts as child processes for specific tasks
- Edge TTS, faster-whisper, FFmpeg orchestration
- Keeps TypeScript as primary language
- Python is already installed (3.14)

```typescript
// Example: Edge TTS call from TypeScript
import { execFile } from 'node:child_process';

async function textToSpeech(text: string, voice: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('edge-tts', [
      '--voice', voice,
      '--file', inputPath,
      '--write-media', outputPath,
      '--write-subtitles', outputPath.replace('.mp3', '.vtt'),
    ], (error) => error ? reject(error) : resolve());
  });
}
```

### Option B: OmniRoute for Everything
- Route TTS through OmniRoute (supports OpenAI, ElevenLabs, etc.)
- Route image gen through OmniRoute (FLUX, Imagen)
- No Python dependency
- Higher cost for TTS (OmniRoute adds margin)

### Recommendation: Option A for free services, Option B for premium
- Edge TTS → subprocess (free)
- faster-whisper → subprocess (free, local)
- Image gen → OmniRoute (FLUX via API)
- Script/Vision → OmniRoute (already integrated)

## 6. Version Pinning Strategy

| Category | Approach |
|----------|----------|
| Node.js | Track LTS (26.x) |
| npm packages | Package-lock.json (exact versions) |
| Python | System Python 3.14 (no venv for subprocess calls) |
| FFmpeg | System install, check version in startup |
| OmniRoute | Local instance, no version coupling |

## 7. Development Environment

### Required
- Node.js 26+
- Python 3.14+ (for Edge TTS, faster-whisper)
- Git
- OmniRoute running on localhost:20128

### Phase 5+ Required
- FFmpeg on PATH (`ffmpeg -version`)
- Pexels API key (free)

### Phase 7+ Required
- GPU (optional, for local image gen if desired)
- YouTube API credentials (for publishing)

### Nice to Have
- Chrome/Edge (for future E2E testing)
- CUDA GPU (for local faster-whisper, local SD)
