// Sends one short sentence in each of ~40 languages through the same code the live backend uses
// (utils/translate.js) and checks that Google detected the language and translated it to English.
// "Please send me a quote for a hydraulic torque wrench for bolts" in each language, so nothing private is sent.
//
//   export GOOGLE_SERVICE_ACCOUNT_JSON="$(aws secretsmanager get-secret-value \
//     --secret-id <your service account secret> --query SecretString --output text --region ap-south-1)"
//   npm run translate:smoke-test
//
// It never prints credentials. About 2,500 characters in total, well inside Google's free monthly amount.

const { translateToEnglish } = require('../utils/translate');

// [expected language code(s), language, text]
const SAMPLES = [
  [['ar'], 'Arabic', 'من فضلكم أرسلوا لي عرض سعر لمفتاح عزم هيدروليكي للمسامير.'],
  [['hi'], 'Hindi', 'कृपया बोल्ट के लिए हाइड्रोलिक टॉर्क रिंच का कोटेशन भेजें।'],
  [['ur'], 'Urdu', 'براہ کرم بولٹ کے لیے ہائیڈرولک ٹارک رینچ کا کوٹیشن بھیجیں۔'],
  [['bn'], 'Bengali', 'অনুগ্রহ করে বোল্টের জন্য হাইড্রোলিক টর্ক রেঞ্চের কোটেশন পাঠান।'],
  [['ta'], 'Tamil', 'போல்ட்டுகளுக்கான ஹைட்ராலிக் டார்க் ரெஞ்சுக்கு விலைப்பட்டியல் அனுப்பவும்.'],
  [['te'], 'Telugu', 'దయచేసి బోల్ట్‌ల కోసం హైడ్రాలిక్ టార్క్ రెంచ్ కోట్ పంపండి.'],
  [['mr'], 'Marathi', 'कृपया बोल्टसाठी हायड्रॉलिक टॉर्क रेंचचे कोटेशन पाठवा.'],
  [['gu'], 'Gujarati', 'કૃપા કરીને બોલ્ટ માટે હાઇડ્રોલિક ટોર્ક રેંચનું ક્વોટેશન મોકલો.'],
  [['pa'], 'Punjabi', 'ਕਿਰਪਾ ਕਰਕੇ ਬੋਲਟਾਂ ਲਈ ਹਾਈਡ੍ਰੌਲਿਕ ਟਾਰਕ ਰੈਂਚ ਦਾ ਕੋਟੇਸ਼ਨ ਭੇਜੋ।'],
  [['ml'], 'Malayalam', 'ദയവായി ബോൾട്ടുകൾക്കായി ഹൈഡ്രോളിക് ടോർക്ക് റെഞ്ചിന്റെ ക്വട്ടേഷൻ അയയ്ക്കുക.'],
  [['kn'], 'Kannada', 'ದಯವಿಟ್ಟು ಬೋಲ್ಟ್‌ಗಳಿಗಾಗಿ ಹೈಡ್ರಾಲಿಕ್ ಟಾರ್ಕ್ ವ್ರೆಂಚ್‌ನ ಕೋಟೇಶನ್ ಕಳುಹಿಸಿ.'],
  [['fa'], 'Persian', 'لطفاً برای پیچ‌ها یک پیشنهاد قیمت آچار گشتاور هیدرولیک ارسال کنید.'],
  [['he', 'iw'], 'Hebrew', 'אנא שלחו לי הצעת מחיר למפתח מומנט הידראולי לברגים.'],
  [['tr'], 'Turkish', 'Lütfen cıvatalar için hidrolik tork anahtarı fiyat teklifi gönderin.'],
  [['ru'], 'Russian', 'Пожалуйста, пришлите коммерческое предложение на гидравлический динамометрический ключ для болтов.'],
  [['uk'], 'Ukrainian', 'Будь ласка, надішліть комерційну пропозицію на гідравлічний динамометричний ключ для болтів.'],
  [['pl'], 'Polish', 'Proszę o przesłanie oferty na hydrauliczny klucz dynamometryczny do śrub.'],
  [['fr'], 'French', "Veuillez m'envoyer un devis pour une clé dynamométrique hydraulique pour boulons."],
  [['es'], 'Spanish', 'Por favor envíenme una cotización de una llave de torque hidráulica para pernos.'],
  [['pt'], 'Portuguese', 'Por favor, envie-me um orçamento de uma chave de torque hidráulica para parafusos.'],
  [['it'], 'Italian', 'Vi prego di inviarmi un preventivo per una chiave dinamometrica idraulica per bulloni.'],
  [['de'], 'German', 'Bitte senden Sie mir ein Angebot für einen hydraulischen Drehmomentschlüssel für Schrauben.'],
  [['nl'], 'Dutch', 'Stuur mij alstublieft een offerte voor een hydraulische momentsleutel voor bouten.'],
  [['sv'], 'Swedish', 'Skicka mig gärna en offert på en hydraulisk momentnyckel för bultar.'],
  [['cs'], 'Czech', 'Pošlete mi prosím nabídku na hydraulický momentový klíč pro šrouby.'],
  [['ro'], 'Romanian', 'Vă rog să-mi trimiteți o ofertă pentru o cheie dinamometrică hidraulică pentru șuruburi.'],
  [['hu'], 'Hungarian', 'Kérem, küldjön árajánlatot hidraulikus nyomatékkulcsra csavarokhoz.'],
  [['el'], 'Greek', 'Παρακαλώ στείλτε μου προσφορά για υδραυλικό δυναμόκλειδο για μπουλόνια.'],
  [['zh-CN', 'zh'], 'Chinese (Simplified)', '请给我发一份用于螺栓的液压扭矩扳手的报价。'],
  [['zh-TW'], 'Chinese (Traditional)', '請給我一份用於螺栓的液壓扭力扳手的報價。'],
  [['ja'], 'Japanese', 'ボルト用の油圧トルクレンチの見積もりを送ってください。'],
  [['ko'], 'Korean', '볼트용 유압 토크 렌치 견적서를 보내주세요.'],
  [['th'], 'Thai', 'กรุณาส่งใบเสนอราคาประแจวัดแรงบิดไฮดรอลิกสำหรับสลักเกลียว'],
  [['vi'], 'Vietnamese', 'Vui lòng gửi cho tôi báo giá cờ lê lực thủy lực cho bu lông.'],
  [['id'], 'Indonesian', 'Mohon kirimkan penawaran harga kunci torsi hidrolik untuk baut.'],
  [['ms', 'id'], 'Malay', 'Sila hantar sebut harga untuk sepana tork hidraulik bagi bolt.'],
  [['tl', 'fil'], 'Filipino', 'Pakipadala sa akin ang presyo ng hydraulic torque wrench para sa mga bolt.'],
  [['sw'], 'Swahili', 'Tafadhali nitumie bei ya spana ya torque ya haidroliki kwa bolti.'],
  [['am'], 'Amharic', 'እባክዎ ለቦልቶች የሃይድሮሊክ ቶርክ ቁልፍ ዋጋ ይላኩልኝ።'],
  [['ne'], 'Nepali', 'कृपया बोल्टका लागि हाइड्रोलिक टर्क रेन्चको कोटेशन पठाउनुहोस्।'],
  [['si'], 'Sinhala', 'කරුණාකර බෝල්ට් සඳහා හයිඩ්‍රොලික් ටෝක් රෙන්ච් එකේ මිල ගණන් එවන්න.'],
];

// Words we expect to find in a correct English translation (any one is enough).
const EXPECT = /torque|wrench|spanner/i;

(async () => {
  let ok = 0;
  const problems = [];

  // 1) English must be recognised as English and not "translated".
  try {
    const r = await translateToEnglish('Please send me a quote for a hydraulic torque wrench for bolts.');
    const pass = r.translated === null && /^en/i.test(r.detectedLanguage || '');
    console.log(`${pass ? 'OK  ' : 'FAIL'} English (control) -> detected "${r.detectedLanguage}", ${r.translated === null ? 'left as is' : 'was translated'}`);
    if (!pass) problems.push('English control');
    else ok += 1;
  } catch (err) {
    return stop(err);
  }

  // 2) Every language.
  for (const [expected, name, text] of SAMPLES) {
    try {
      const r = await translateToEnglish(text);
      const detectedOk = expected.some((c) => (r.detectedLanguage || '').toLowerCase() === c.toLowerCase());
      const textOk = typeof r.translated === 'string' && EXPECT.test(r.translated);
      const pass = detectedOk && textOk;
      console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(22)} detected "${r.detectedLanguage}" (expected ${expected.join('/')}) -> ${(r.translated || '(no translation)').slice(0, 70)}`);
      if (pass) ok += 1;
      else problems.push(`${name}${detectedOk ? '' : ` (detected ${r.detectedLanguage})`}${textOk ? '' : ' (translation missing the expected words)'}`);
    } catch (err) {
      return stop(err);
    }
  }

  // 3) Things that are not a language.
  for (const [label, text] of [['numbers only', '12345 67890'], ['one emoji', '👍'], ['mixed Arabic + product code', 'أحتاج مفتاح عزم TSL-5 هيدروليكي']]) {
    try {
      const r = await translateToEnglish(text);
      console.log(`INFO ${label.padEnd(30)} detected "${r.detectedLanguage}", ${r.unknownLanguage ? 'language not recognised (handled)' : r.translated === null ? 'left as is' : `-> ${r.translated.slice(0, 50)}`}`);
    } catch (err) {
      return stop(err);
    }
  }

  console.log(`\n${ok} of ${SAMPLES.length + 1} checks passed.`);
  if (problems.length) console.log(`Needs a look: ${problems.join('; ')}`);
  process.exit(problems.length ? 1 : 0);
})();

function stop(err) {
  const hints = {
    TRANSLATE_NOT_CONFIGURED: 'GOOGLE_SERVICE_ACCOUNT_JSON (or _EMAIL + GOOGLE_PRIVATE_KEY) is not set in this terminal.',
    TRANSLATE_DENIED: 'Google refused the request. In the service account\'s Google Cloud project: enable "Cloud Translation API", turn billing on, and give the account the role "Cloud Translation API User".',
    TRANSLATE_QUOTA: 'The translation quota is used up. Try again later.',
    TRANSLATE_TIMEOUT: 'Google took too long to answer. Check the internet connection and try again.',
  };
  console.error(`\nStopped: ${err.code || 'error'} - ${err.message}`);
  if (hints[err.code]) console.error(hints[err.code]);
  process.exit(1);
}
