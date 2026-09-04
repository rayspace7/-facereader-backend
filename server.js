import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // 실제 배포 시에는 미니앱 도메인만 허용하도록 좁혀주세요.
app.use(express.json({ limit: '10mb' })); // 사진 base64 용량 고려

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash'; // 무료 티어에서 사용 가능한 최신 모델이에요.
const PORT = process.env.PORT || 8787;

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY가 설정되지 않았어요. .env 파일을 확인해주세요.');
}

const SYSTEM_PROMPT = `너는 유쾌하고 위트있는 톤으로 '관상'을 봐주는 엔터테인먼트 콘텐츠 작가야. 실제 과학적 근거가 있는 것처럼 단정짓지 말고, 재미있게 풀어내되 매번 칭찬 일색이 되지 않도록 해.

각 얼굴 부위마다 반드시 "strength"(장점)와 "caution"(장난스럽고 애정 어린 주의 포인트)을 하나씩 같이 써줘. caution은 외모를 비하하거나 진짜로 기분 나쁠 수 있는 표현은 절대 쓰지 말고, "이런 날은 지출 조심!", "고집 부리다 손해 볼 수도" 처럼 성격·습관·운 쪽의 장난스러운 포인트로 풀어내. 늘 애정 있고 유쾌한 톤을 유지해.

또한 "오늘의 운"을 한 문장으로 만들어줘. 매번 다른 느낌(도전적인 날, 신중해야 하는 날, 인복이 따르는 날 등)이 나오도록 다양하게 표현해.

반드시 아래 JSON 형식으로만 응답해.
{
  "type": "네 글자 이내의 관상 유형 별명 (예: 대기만성형, 재물복형, 인복만렙형)",
  "forehead": { "strength": "이마의 장점 한 문장", "caution": "이마 관련 장난스러운 주의 포인트 한 문장" },
  "eyebrows": { "strength": "눈썹의 장점 한 문장", "caution": "눈썹 관련 장난스러운 주의 포인트 한 문장" },
  "eyes": { "strength": "눈의 장점 한 문장", "caution": "눈 관련 장난스러운 주의 포인트 한 문장" },
  "nose": { "strength": "코의 장점 한 문장", "caution": "코 관련 장난스러운 주의 포인트 한 문장" },
  "mouth_chin": { "strength": "입/턱의 장점 한 문장", "caution": "입/턱 관련 장난스러운 주의 포인트 한 문장" },
  "overall": "전체 총평 세 문장 내외, 따뜻하고 위트있게",
  "today_fortune": "오늘의 운을 한 문장으로, 매번 다른 톤으로"
}`;

// 일시적 오류(503 등)일 때 잠깐 기다렸다가 자동으로 다시 시도해요.
async function callGeminiWithRetry(url, body, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    const errText = await response.text();
    lastError = { status: response.status, body: errText };

    // 503(과부하), 429(요청 과다)처럼 "잠깐 후 다시 하면 될 만한" 오류만 재시도해요.
    const isRetryable = response.status === 503 || response.status === 429;
    if (!isRetryable || attempt === maxRetries) {
      console.error(`Gemini API 오류 (시도 ${attempt + 1}/${maxRetries + 1}):`, response.status, errText);
      break;
    }

    const waitMs = 1000 * (attempt + 1); // 1초, 2초 순서로 대기
    console.warn(`Gemini API 일시 오류(${response.status}), ${waitMs}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const error = new Error('Gemini API 호출 실패');
  error.details = lastError;
  throw error;
}

app.post('/api/gwansang', async (req, res) => {
  try {
    const { image, mediaType } = req.body;
    if (!image) {
      return res.status(400).json({ error: '이미지가 필요해요.' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    let response;
    try {
      response = await callGeminiWithRetry(url, {
        contents: [
          {
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT + '\n\n이 사진 속 인물의 관상을 위 형식의 JSON으로 봐줘.' },
              { inline_data: { mime_type: mediaType || 'image/jpeg', data: image } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json', // Gemini가 JSON만 반환하도록 강제해요.
          temperature: 0.9,
        },
      });
    } catch (err) {
      console.error('Gemini API 재시도 끝에 최종 실패:', err.details || err.message);
      return res.status(502).json({ error: 'AI 분석 서버가 일시적으로 혼잡해요. 잠시 후 다시 시도해주세요.' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('응답에 텍스트가 없어요.');

    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    console.error('관상 분석 처리 오류:', err);
    res.status(500).json({ error: '분석 중 오류가 발생했어요.' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`관상 백엔드 서버 실행 중: http://localhost:${PORT}`);
});
