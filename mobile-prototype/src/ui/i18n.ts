export type Lang = 'mn' | 'en';
const T: Record<string, [string, string]> = {
  subtitle: ['iPhone дээр тоглох 3D туршилтын хувилбар', 'Playable 3D prototype for iPhone'],
  loading: ['Бодит газрын зургийн өгөгдлийг ачаалж байна…', 'Loading real map data…'],
  play: ['ТОГЛОХ', 'PLAY'],
  notice: ['Туршилтын хувилбар. Барилгууд нь бодит суурь дээр босгосон түр зуурын хэлбэр, фасад нь процедураар зурсан. Баатар мөн түр зуурын загвар. Байршил, зам, газрын гадарга нь бодит нээлттэй өгөгдөл.',
    'Prototype. Buildings are temporary massing on real footprints with a procedural facade; the character is a temporary stand-in. Positions, roads and terrain are real open data.'],
  rotate: ['Утсаа хэвтээ болгоно уу', 'Rotate your phone to landscape'],
  homescreen: ['Бүтэн дэлгэцээр тоглох бол Safari-н Share цэснээс "Add to Home Screen" сонгоно уу.', 'For full screen, use Safari Share, then "Add to Home Screen".'],
  jump: ['Үсрэх', 'Jump'], run: ['Гүйх', 'Run'],
  settings: ['Тохиргоо', 'Settings'], close: ['Хаах', 'Close'],
  language: ['Хэл', 'Language'], quality: ['График', 'Graphics'],
  q_auto: ['Авто', 'Auto'], q_low: ['Бага', 'Low'], q_medium: ['Дунд', 'Medium'], q_high: ['Өндөр', 'High'],
  sensitivity: ['Камерын мэдрэмж', 'Camera sensitivity'], showFps: ['FPS харуулах', 'Show FPS'],
  time: ['Цаг', 'Time'], t_live: ['Бодит цаг', 'Live'], t_free: ['Чөлөөт', 'Free play'],
  weather: ['Цаг агаар', 'Weather'], w_live: ['Бодит', 'Live'], w_clear: ['Цэлмэг', 'Clear'], w_cloudy: ['Үүлэрхэг', 'Cloudy'],
  w_snow: ['Цас', 'Snow'], w_rain: ['Бороо', 'Rain'], w_fog: ['Манан', 'Fog'],
  travel: ['Очих газар', 'Travel to'], about: ['Мэдээлэл', 'About'],
  aboutText: ['Өгөгдөл: Overture Maps (OpenStreetMap-ийг агуулсан), AWS Terrain Tiles, Open-Meteo. Барилгын өндрийн ихэнх нь тооцоолсон утга (эх сурвалжид өндөр байхгүй). Замын төв шугам чимэглэлийн зориулалттай. Од, үүлний хэлбэр процедураар зурагдсан.',
    'Data: Overture Maps (includes OpenStreetMap), AWS Terrain Tiles, Open-Meteo. Most building heights are estimates (the source has no height). Road centre lines are decorative. Star and cloud shapes are procedural.'],
  live: ['ШУУД', 'LIVE'], stale: ['ХУУЧИН', 'STALE'], unavailable: ['цаг агаарын мэдээ алга', 'weather unavailable'],
  manual: ['ГАРААР', 'MANUAL'], free: ['ЧӨЛӨӨТ', 'FREE'],
  ago: ['мин өмнө', 'min ago'], sunrise: ['Нар мандах', 'Sunrise'], sunset: ['Нар жаргах', 'Sunset'],
  areaLoading: ['Орчныг ачаалж байна…', 'Loading area…'],
  k_clear: ['Цэлмэг', 'Clear'], k_partly: ['Багавтар үүлтэй', 'Partly cloudy'], k_cloudy: ['Үүлэрхэг', 'Overcast'],
  k_fog: ['Манантай', 'Fog'], k_drizzle: ['Шиврээ бороо', 'Drizzle'], k_rain: ['Бороо', 'Rain'], k_snow: ['Цас', 'Snow'],
  k_thunder: ['Аянгатай бороо', 'Thunderstorm'], k_unknown: ['Тодорхойгүй', 'Unknown'],
  dataError: ['Газрын зургийн өгөгдлийг ачаалж чадсангүй.', 'Could not load the map data.'],
  noWebgl: ['Энэ хөтөч WebGL дэмжихгүй байна.', 'This browser does not support WebGL.'],
  lm_sukhbaatar_square: ['Сүхбаатарын талбай', 'Sukhbaatar Square'], lm_government_palace: ['Засгийн газрын ордон', 'Government Palace'],
  lm_state_department_store: ['Улсын их дэлгүүр (Энхтайвны өргөн чөлөө)', 'State Department Store (Peace Avenue)'],
  lm_blue_sky_tower: ['Блю Скай цамхаг', 'Blue Sky Tower'], lm_shangri_la: ['Шангри-Ла', 'Shangri-La'],
  lm_chinggis_khaan_museum: ['Чингис хаан музей', 'Chinggis Khaan Museum'], lm_zaisan_hill: ['Зайсан толгой', 'Zaisan Hill'],
  lm_zaisan_square: ['Зайсан талбай', 'Zaisan Square'],
};
let lang: Lang = 'mn';
export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
}
export function t(key: string): string {
  const v = T[key];
  return v ? v[lang === 'mn' ? 0 : 1] : key;
}
