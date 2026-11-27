-- Datos para la prueba de contrato de cupones y combos. La API los crea solo
-- desde el panel (con 2FA), así que se insertan aquí tras el seed de ejemplo
-- (SEED_DEMO=true y un administrador con SEED_ADMIN_EMAIL, que firma los cupones).
--
--   PGPASSWORD=petbf psql -h localhost -U petbf -d petbf_contract \
--     -v ON_ERROR_STOP=1 -f contract/promotions.sql
--
-- Se puede ejecutar varias veces: no duplica nada.

INSERT INTO coupons (
  id, code, description, type, value, "minSubtotalUsdCents",
  "maxDiscountUsdCents", "endsAt", "maxRedemptions", "perUserLimit",
  "isActive", "createdById", "updatedAt"
)
SELECT gen_random_uuid(), c.code, c.description, c.type::"CouponType", c.value,
       c.min_subtotal, c.max_discount, c.ends_at, NULL, 1, true, u.id, now()
FROM users u
CROSS JOIN (
  VALUES
    ('CONTRATO-10', '10 % de descuento', 'PERCENT', 10, 0, NULL::int, NULL::timestamp),
    ('CONTRATO-TOPE', '50 % con tope de 5 $', 'PERCENT', 50, 0, 500, NULL),
    ('CONTRATO-FIJO', '1000 $ de descuento', 'FIXED', 100000, 0, NULL, NULL),
    ('CONTRATO-MIN', 'Desde 1000 $', 'FIXED', 100, 100000, NULL, NULL),
    ('CONTRATO-VENCIDO', 'Venció', 'FIXED', 100, 0, NULL, TIMESTAMP '2020-01-01')
) AS c(code, description, type, value, min_subtotal, max_discount, ends_at)
WHERE u.email = lower('contrato-admin@petbf.test')
ON CONFLICT (code) DO NOTHING;

-- Alimento 3 kg (14,50 $) + jaula mediana (35,00 $) = 49,50 $ por separado,
-- a 45,00 $: ahorra 4,50 $.
INSERT INTO combos (id, name, slug, description, "priceUsdCents", "isActive", "updatedAt")
VALUES (
  gen_random_uuid(), 'Combo de contrato', 'combo-de-contrato',
  'Alimento y jaula juntos, para la prueba de contrato.', 4500, true, now()
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO combo_items (id, "comboId", "variantId", quantity)
SELECT gen_random_uuid(), c.id, v.id, 1
FROM combos c
JOIN product_variants v ON v.sku IN ('NP-PA-3', 'JA-M')
WHERE c.slug = 'combo-de-contrato'
ON CONFLICT ("comboId", "variantId") DO NOTHING;
