export type Lang = 'mn' | 'en';
const T: Record<string, [string, string]> = {
  subtitle: ['iPhone дээр тоглох 3D туршилтын хувилбар', 'Playable 3D prototype for iPhone'],
  loading: ['Бодит газрын зургийн өгөгдлийг ачаалж байна…', 'Loading real map data…'],
  play: ['ТОГЛОХ', 'PLAY'],
  notice: ['Туршилтын хувилбар. Байршил, зам, барилгын суурь, газрын гадарга, дүүргийн хил нь бодит нээлттэй өгөгдөл. Барилгын фасад, ихэнх өндөр, явган зам, гэрлийн шон, замын тэмдэглэгээ нь процедураар үүсгэсэн тооцоо. Баатар бол сайжруулсан түр загвар.',
    'Prototype. Positions, roads, building footprints, terrain and district borders are real open data. Facades, most building heights, sidewalks, streetlights and road markings are procedural estimates. The character is an improved stand-in.'],
  rotate: ['Утсаа хэвтээ болгоно уу', 'Rotate your phone to landscape'],
  homescreen: ['Бүтэн дэлгэцээр тоглох бол Safari-н Share цэснээс "Add to Home Screen" сонгоно уу.', 'For full screen, use Safari Share, then "Add to Home Screen".'],
  jump: ['Үсрэх', 'Jump'], run: ['Гүйх', 'Run'],
  settings: ['Тохиргоо', 'Settings'], close: ['Хаах', 'Close'],
  language: ['Хэл', 'Language'], quality: ['График', 'Graphics'],
  q_auto: ['Авто', 'Auto'], q_low: ['Бага', 'Low'], q_medium: ['Дунд', 'Medium'], q_high: ['Өндөр', 'High'],
  fpsCap: ['Кадрын хязгаар', 'Frame rate'], fps30: ['30 FPS (утас халахгүй)', '30 FPS (cooler)'], fps60: ['60 FPS (гөлгөр, халуун)', '60 FPS (smoother, hotter)'],
  sensitivity: ['Камерын мэдрэмж', 'Camera sensitivity'], showFps: ['FPS харуулах', 'Show FPS'],
  time: ['Цаг', 'Time'], t_live: ['Бодит цаг', 'Live'], t_free: ['Чөлөөт', 'Free play'],
  weather: ['Цаг агаар', 'Weather'], w_live: ['Бодит', 'Live'], w_clear: ['Цэлмэг', 'Clear'], w_cloudy: ['Үүлэрхэг', 'Cloudy'],
  w_snow: ['Цас', 'Snow'], w_rain: ['Бороо', 'Rain'], w_fog: ['Манан', 'Fog'],
  travel: ['Очих газар', 'Travel to'], about: ['Мэдээлэл', 'About'],
  aboutText: ['Өгөгдөл: Overture Maps (OpenStreetMap-ийг агуулсан), AWS Terrain Tiles, Open-Meteo. Эх сурвалжид өндөр нь байхгүй барилгуудын өндрийг суурийн талбай, ангиллаас нь тооцоолсон (хэмжилт биш). Засгийн газрын ордны өндөр ойролцоо тооцоо. Явган зам, хашлага, гэрлийн шон, замын зураас чимэглэлийн зориулалттай. Од, үүл, хотын гэрэлтэлт процедураар зурагдсан.',
    'Data: Overture Maps (includes OpenStreetMap), AWS Terrain Tiles, Open-Meteo. Where the source has no height, building heights are estimated from footprint area and class (not surveyed). The Government Palace height is approximate. Sidewalks, curbs, streetlights and lane markings are decorative. Stars, clouds and city glow are procedural.'],
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
