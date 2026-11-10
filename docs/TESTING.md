# Testing

## Automated (no engine)
`scripts/test_all.sh`: core C++ (2,061 checks), pipeline (7), server (10, one live call that
skips itself offline).

## First on-device pass (to do; nothing here has been run)

| Test | How | Pass |
|---|---|---|
| Boot | Launch at Sukhbaatar Square | Ground appears, player drops onto it, HUD shows local time |
| Live sync | Compare HUD with a phone clock set to Ulaanbaatar and with the server's `/v1/world` | Same time, temperature and condition; LIVE dot on |
| Stale | Stop the server for 25 minutes | Last values stay, warning shown, LIVE dot off |
| Touch | Walk, look, jump with three fingers at once; drive; ride | No stuck or missed inputs; nothing under the notch |
| Drive | Square to Zaisan along the blue GPS line | No missing ground, no visible pop-in at 60 km/h |
| Horse | Mount at Zaisan Square, walk, trot, gallop until tired, dismount | Stamina drains and recovers |
| Frame rate | `stat unit`, `stat fps` for 10 minutes per preset | LOW 30, MEDIUM 30-45, HIGH 45-60 |
| Memory | `memreport -full`, Xcode Instruments, Android Studio profiler | No growth over a 20-minute drive |
| Heat | 30 minutes of driving | Governor steps down before the OS throttles |
| Battery | Percent per 30 minutes at each preset | Recorded per device |

Devices to cover: one entry-level Android (4 GB RAM), one mid-range, one flagship, one older
iPhone and one current iPhone, plus a tablet for the 4:3 layout. Record results in a table
here, then fill in `Config/DefaultDeviceProfiles.ini`.
