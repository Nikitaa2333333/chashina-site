# Готовит вебовые дериваты кадров съёмки в клинике «Атлас».
#
# Исходники (1440px, ~7 МБ) лежат в photos-src/ и в сборку не попадают.
# Скрипт раскладывает отобранные кадры в public/photos/clinic/ под
# осмысленными именами и делает два размера:
#
#   clinic/<slug>.webp      900px по длинной стороне — тайлы мозаики и врезки
#   clinic/lg/<slug>.webp  1440px                    — лайтбокс
#
# Запуск:  pwsh -File scripts/build-photos.ps1
# Требует ImageMagick 7 (magick в PATH).

$ErrorActionPreference = 'Stop'
$env:MAGICK_MEMORY_LIMIT = '2GiB'
$env:MAGICK_MAP_LIMIT = '4GiB'

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'photos-src\chashina-atlas'
$dst  = Join-Path $root 'public\photos\clinic'
$dstL = Join-Path $dst 'lg'

New-Item -ItemType Directory -Force -Path $dst, $dstL | Out-Null

# Исходный файл → slug. Порядок здесь ни на что не влияет: раскладку
# галереи задаёт массив GALLERY в src/pages/index.astro.
$map = [ordered]@{
  # врезки в секции
  '36' = 'portrait-studio-01'   # «Обо мне», студийный портрет на светлом
  '25' = 'interior-01'          # «Где я принимаю», зона ожидания
  '46' = 'procedure-01'         # «Инъекционные методы», крупный план

  # галерея — приём и консультация
  '45' = 'procedure-02'
  '22' = 'consult-01'
  '13' = 'consult-03'
  '23' = 'consult-05'
  '39' = 'consult-06'
  '21' = 'consult-07'
  '01' = 'consult-08'
  '40' = 'consult-02'
  '44' = 'consult-04'
  '42' = 'consult-09'

  # галерея — интерьер клиники
  '30' = 'interior-02'
  '27' = 'interior-03'
  '24' = 'interior-04'
  '29' = 'interior-05'
  '26' = 'interior-06'

  # галерея — портреты
  '33' = 'portrait-dark-01'
  '31' = 'portrait-dark-02'
  '51' = 'portrait-wall-01'
  '48' = 'portrait-wall-02'
  '38' = 'portrait-light-01'
}

$rows = @()

foreach ($num in $map.Keys) {
  $slug = $map[$num]
  $in   = Join-Path $src "$num.jpg"
  if (-not (Test-Path $in)) { throw "нет исходника: $in" }

  # 900px — тайл и врезка. 1440px — лайтбокс.
  & magick $in -resize '900x900>'   -quality 80 -define webp:method=6 (Join-Path $dst  "$slug.webp")
  & magick $in -resize '1440x1440>' -quality 82 -define webp:method=6 (Join-Path $dstL "$slug.webp")

  $dim = (& magick identify -format '%w %h' (Join-Path $dst "$slug.webp")) -split ' '
  $rows += [pscustomobject]@{
    slug = $slug; src = "$num.jpg"
    w = [int]$dim[0]; h = [int]$dim[1]
    orient = if ([int]$dim[1] -gt [int]$dim[0]) { 'v' } else { 'h' }
  }
}

# Квадратная аватарка для «Обо мне»: кроп от верха, чтобы лицо не срезалось.
$avatarSrc = Join-Path $src '36.jpg'
& magick $avatarSrc -resize '800x' -gravity north -crop '800x800+0+40' +repage `
  -quality 82 -define webp:method=6 (Join-Path $dst 'about-avatar.webp')

$rows | Format-Table -AutoSize
"`n{0} кадров, {1:N0} КБ в clinic/, {2:N0} КБ в clinic/lg/" -f `
  $rows.Count,
  ((Get-ChildItem "$dst\*.webp" | Measure-Object Length -Sum).Sum / 1KB),
  ((Get-ChildItem "$dstL\*.webp" | Measure-Object Length -Sum).Sum / 1KB)
