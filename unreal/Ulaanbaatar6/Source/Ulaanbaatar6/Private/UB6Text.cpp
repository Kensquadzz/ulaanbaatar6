// This file is UTF-8 (Mongolian Cyrillic literals).
#include "UB6Text.h"

FString UUB6Text::Get(const FString& Key, bool bMongolian)
{
	struct FPair { const TCHAR* En; const TCHAR* Mn; };
	static const TMap<FString, FPair> Table = {
		{TEXT("weather.clear"), {TEXT("Clear"), TEXT("Цэлмэг")}},
		{TEXT("weather.partly_cloudy"), {TEXT("Partly cloudy"), TEXT("Багавтар үүлтэй")}},
		{TEXT("weather.overcast"), {TEXT("Overcast"), TEXT("Үүлэрхэг")}},
		{TEXT("weather.fog"), {TEXT("Fog"), TEXT("Манантай")}},
		{TEXT("weather.drizzle"), {TEXT("Drizzle"), TEXT("Шиврээ бороо")}},
		{TEXT("weather.rain"), {TEXT("Rain"), TEXT("Бороо")}},
		{TEXT("weather.freezing_rain"), {TEXT("Freezing rain"), TEXT("Хөлдүү бороо")}},
		{TEXT("weather.snow"), {TEXT("Snow"), TEXT("Цас")}},
		{TEXT("weather.thunderstorm"), {TEXT("Thunderstorm"), TEXT("Аянга цахилгаантай бороо")}},
		{TEXT("weather.unknown"), {TEXT("Unknown"), TEXT("Тодорхойгүй")}},
		{TEXT("hud.title"), {TEXT("ULAANBAATAR 6"), TEXT("УЛААНБААТАР 6")}},
		{TEXT("hud.live"), {TEXT("LIVE WORLD"), TEXT("ШУУД ДЭЛХИЙ")}},
		{TEXT("hud.free_play"), {TEXT("FREE PLAY"), TEXT("ЧӨЛӨӨТ ТОГЛОЛТ")}},
		{TEXT("hud.stale"), {TEXT("Weather data is out of date"), TEXT("Цаг агаарын мэдээ хуучирсан")}},
		{TEXT("hud.unavailable"), {TEXT("Weather unavailable"), TEXT("Цаг агаарын мэдээ алга")}},
		{TEXT("hud.last_sync"), {TEXT("Last sync"), TEXT("Сүүлд шинэчилсэн")}},
		{TEXT("hud.feels_like"), {TEXT("Feels like"), TEXT("Мэдрэгдэх")}},
		{TEXT("hud.wind"), {TEXT("Wind"), TEXT("Салхи")}},
		{TEXT("hud.humidity"), {TEXT("Humidity"), TEXT("Чийгшил")}},
		{TEXT("hud.sunrise"), {TEXT("Sunrise"), TEXT("Нар мандах")}},
		{TEXT("hud.sunset"), {TEXT("Sunset"), TEXT("Нар жаргах")}},
		{TEXT("hud.fuel"), {TEXT("Fuel"), TEXT("Шатахуун")}},
		{TEXT("hud.stamina"), {TEXT("Stamina"), TEXT("Тэнхээ")}},
		{TEXT("hud.loading"), {TEXT("Loading the city..."), TEXT("Хотыг ачаалж байна...")}},
		{TEXT("hud.route"), {TEXT("Route"), TEXT("Зам")}},
		{TEXT("prompt.enter_car"), {TEXT("Enter car"), TEXT("Машинд суух")}},
		{TEXT("prompt.mount_horse"), {TEXT("Mount horse"), TEXT("Морь унах")}},
		{TEXT("btn.jump"), {TEXT("Jump"), TEXT("Үсрэх")}},
		{TEXT("btn.sprint"), {TEXT("Sprint"), TEXT("Гүйх")}},
		{TEXT("btn.interact"), {TEXT("Use"), TEXT("Ашиглах")}},
		{TEXT("btn.crouch"), {TEXT("Crouch"), TEXT("Суух")}},
		{TEXT("btn.phone"), {TEXT("Phone"), TEXT("Утас")}},
		{TEXT("btn.gas"), {TEXT("Gas"), TEXT("Хаз")}},
		{TEXT("btn.brake"), {TEXT("Brake"), TEXT("Тоормос")}},
		{TEXT("btn.handbrake"), {TEXT("Handbrake"), TEXT("Гар тоормос")}},
		{TEXT("btn.reverse"), {TEXT("Reverse"), TEXT("Ухрах")}},
		{TEXT("btn.camera"), {TEXT("Camera"), TEXT("Камер")}},
		{TEXT("btn.exit"), {TEXT("Exit"), TEXT("Буух")}},
		{TEXT("btn.left"), {TEXT("Left"), TEXT("Зүүн")}},
		{TEXT("btn.right"), {TEXT("Right"), TEXT("Баруун")}},
		{TEXT("btn.gait_up"), {TEXT("Faster"), TEXT("Хурдлах")}},
		{TEXT("btn.gait_down"), {TEXT("Slower"), TEXT("Удаашрах")}},
		{TEXT("btn.dismount"), {TEXT("Dismount"), TEXT("Мориноос буух")}},
		{TEXT("gait.0"), {TEXT("Halt"), TEXT("Зогсолт")}},
		{TEXT("gait.1"), {TEXT("Walk"), TEXT("Алхаа")}},
		{TEXT("gait.2"), {TEXT("Trot"), TEXT("Шогшоо")}},
		{TEXT("gait.3"), {TEXT("Gallop"), TEXT("Давхиа")}},
	};
	if (const FPair* P = Table.Find(Key)) return bMongolian ? P->Mn : P->En;
	return Key;
}
