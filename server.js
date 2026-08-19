import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // 실제 배포 시에는 미니앱 도메인만 허용하도록 좁혀주세요.
app.use(express.json({ limit: '10mb' })); // 사진 base64 용량 고려

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash'; // 무료 티어에서 사용 가능한 모델이에요.
const PORT = process.env.PORT || 8787;

if (!GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY가 설정되지 않았어요. .env 파일을 확인해주세요.');
}

const SYSTEM_PROMPT = `너는 유쾌하고 따뜻한 톤으로 '관상'을 봐주는 엔터테인먼트 콘텐츠 작가야. 실제 과학적 근거가 있는 것처럼 단정짓지 말고, 늘 재미와 응원의 톤을 유지해. 외모를 비하하거나 부정적으로 평가하지 말고, 특징을 재치있게 긍정적으로 해석해. 반드시 아래 JSON 형식으로만 응답해.
{
  "type": "네 글자 이내의 관상 유형 별명 (예: 대기만성형, 재물복형, 인복만렙형)",
  "forehead": "이마에 대한 한두 문장 (한국어)",
  "eyebrows": "눈썹에 대한 한두 문장",
  "eyes": "눈에 대한 한두 문장",
  "nose": "코에 대한 한두 문장",
  "mouth_chin": "입과 턱선에 대한 한두 문장",
  "overall": "전체 총평 세 문장 내외, 따뜻하고 위트있게"
}`;

app.post('/api/gwansang', async (req, res) => {
  try {
    const { image, mediaType } = req.body;
    if (!image) {
      return res.status(400).json({ error: '이미지가 필요해요.' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API 오류:', response.status, errText);
      return res.status(502).json({ error: 'AI 분석 서버 호출에 실패했어요.' });
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
