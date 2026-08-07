# Промпты для иллюстраций — сайт Оксаны Чащиной

Стиль всей серии: стерильная «лабораторная» эстетика + жизнь настоящего человека.
Гамма сайта: лайм `#cef79e`, тёмный зелёно-чернильный `#222f30`, костяной белый `#f7f7f5`,
сейдж/морской `#445e5f`, серый `#e4e3e3`.

Общий хвост для всех промптов (добавлять в конец):

```
soft diffused studio light, sterile clinical elegance, glass and translucency,
muted sage green and pale lime color palette (#cef79e, #445e5f, #f7f7f5),
premium skincare campaign aesthetic, medical minimalism, high-end editorial photography,
shot on medium format, shallow depth of field, 8k, hyperdetailed
--no text, logos, labels, watermark, hands with six fingers, oversaturated colors
```

Для вертикальных плашек слайдера — `--ar 3:4`. Для круглых вставок в текст — `--ar 1:1`.

---

## 1. Световые и лазерные методики (плашка 01, 3:4)

```
macro photography of thin beams of pale green laser light refracting through
a sculptural glass prism onto a smooth skin-like ceramic surface, delicate
light caustics, floating dust particles in the beam, dark teal background #222f30,
single lime-green light accent #cef79e
```

## 2. Радиоволновой лифтинг (плашка 02, 3:4)

```
abstract macro of concentric silky waves rippling through translucent
pale-green gel, warm gentle glow from beneath, smooth organic rings radiating
from a single point, resembling controlled warmth spreading through tissue,
bone-white background #f7f7f5
```

## 3. Токи и микротоки (плашка 03, 3:4)

```
macro photography of clear serum droplets suspended on a pane of glass,
fine luminous filaments of pale lime light #cef79e connecting the droplets
like a delicate neural network, sage green blurred background #445e5f,
crisp reflections, weightless laboratory stillness
```

## 4. Фокусированный ультразвук (плашка 04, 3:4)

```
abstract macro of a perfect circular wave focusing toward a single point
in dark translucent water, rings converging inward, subtle depth layers
visible beneath the surface, deep green-black palette #222f30 with one
thin lime highlight ring #cef79e
```

## 5. Студийный портрет (стекло + человек, 3:4)

```
studio portrait of an elegant woman in her 40s with luminous well-cared skin,
half of her face seen through a tall pane of frosted glass she gently touches,
serene direct gaze, natural makeup, bone-white seamless background #f7f7f5,
soft clinical light, calm confidence, real human warmth inside sterile minimalism
```

## 6. Ботаническая абстракция в стекле (3:4)

```
green eucalyptus and kelp-like leaves suspended in a slab of translucent
rippled glass, soft backlight through the glass, blurred organic shapes,
palette of deep sage #445e5f and pale lime #cef79e on bone white,
abstract botanical still life, weightless and serene
```

## 7. Натюрморт с продуктами (3:4)

```
minimal still life of unbranded frosted-glass skincare vials and a petri dish
with a single green gel capsule, arranged on layered stone and glass pedestals,
bone-white scene #f7f7f5 with one pale lime accent object #cef79e,
museum-like composition, long soft shadows
```

## 8. Круглые мини-вставки в текст (1:1, серия)

По одному промпту на кружок — крупный план, объект в центре кадра:

```
a) extreme macro of a single green gel capsule on white glass, centered
b) one fresh sage leaf with a water drop, centered on bone-white
c) extreme macro of a clear serum bubble with lime-green core, centered
d) top view of rippling water circle in a white ceramic bowl, centered
```

---

Куда класть готовое: `public/photos/art/` (плашки: `method-01.webp` … `method-04.webp`,
портрет `portrait-glass.webp`, ботаника `botanical.webp`, натюрморт `still-life.webp`,
кружки `dot-a.webp` … `dot-d.webp`). Скажи Клоду — он подключит их в слайдер и манифест.
