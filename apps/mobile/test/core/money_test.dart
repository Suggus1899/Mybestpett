import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/money.dart';

void main() {
  group('usdCentsToVesCents', () {
    test('multiplica por la tasa y redondea a céntimos', () {
      expect(usdCentsToVesCents(1250, '36.5'), 45625); // 12,50 $ × 36,5
      expect(usdCentsToVesCents(100, '36.51234567'), 3651); // 36,5123… -> 36,51
      expect(usdCentsToVesCents(100, '36.515'), 3652); // mitad hacia arriba
      expect(usdCentsToVesCents(100, '36.5149'), 3651);
      expect(usdCentsToVesCents(0, '36.5'), 0);
      expect(usdCentsToVesCents(1, '1'), 1);
    });

    test('acepta tasas enteras', () {
      expect(usdCentsToVesCents(250, '40'), 10000);
    });

    test('rechaza tasas mal formadas', () {
      for (final bad in ['', 'abc', '36,5', '-1', '1e3', '.5', '5.']) {
        expect(
          () => usdCentsToVesCents(100, bad),
          throwsFormatException,
          reason: bad,
        );
      }
    });

    test('no pierde precisión con montos grandes', () {
      // 1.000.000 $ (máximo de la API) a 99.999,99999999 Bs
      expect(usdCentsToVesCents(100000000, '99999.99999999'), 9999999999999);
    });
  });

  group('chargeCents (mismo cálculo que la API)', () {
    test('USD y USDT se cobran 1:1', () {
      expect(chargeCents(2490, Currency.usd), 2490);
      expect(chargeCents(2490, Currency.usdt), 2490);
    });

    test('Bs con la tasa del dólar', () {
      expect(chargeCents(2490, Currency.ves, usdVes: '36.5'), 90885);
    });

    test('euros: USD × tasa del dólar ÷ tasa del euro', () {
      // 10 $ × 36,5 / 39,8 = 9,1708… -> 9,17 €
      expect(
        chargeCents(1000, Currency.eur, usdVes: '36.5', eurVes: '39.8'),
        917,
      );
      // 0,01 $ con tasas iguales -> 0,01 €
      expect(
        chargeCents(1, Currency.eur, usdVes: '40.1234', eurVes: '40.1234'),
        1,
      );
    });

    test('euros redondea la mitad hacia arriba', () {
      // 1 $ × 1 / 8 = 0,125 € -> 0,13 €
      expect(chargeCents(100, Currency.eur, usdVes: '1', eurVes: '8'), 13);
    });

    test('sin la tasa necesaria devuelve null', () {
      expect(chargeCents(1000, Currency.ves), isNull);
      expect(chargeCents(1000, Currency.eur, usdVes: '36.5'), isNull);
      expect(chargeCents(1000, Currency.eur, eurVes: '39.8'), isNull);
    });

    test('tasa del euro en cero no divide por cero', () {
      expect(
        chargeCents(1000, Currency.eur, usdVes: '36.5', eurVes: '0'),
        isNull,
      );
    });
  });

  group('decimalToCents y centsToApiAmount', () {
    test('lee los decimales de Prisma', () {
      expect(decimalToCents('123.45'), 12345);
      expect(decimalToCents('123.4'), 12340);
      expect(decimalToCents('100'), 10000);
      expect(decimalToCents('0.5'), 50);
      expect(decimalToCents('9.999'), 1000);
      expect(decimalToCents('9.994'), 999);
    });

    test('escribe el monto con punto y 2 decimales', () {
      expect(centsToApiAmount(12345), '123.45');
      expect(centsToApiAmount(5), '0.05');
      expect(centsToApiAmount(10000), '100.00');
      expect(centsToApiAmount(0), '0.00');
    });
  });

  group('shippingCostCents', () {
    test('gratis desde el mínimo de la zona, inclusive', () {
      expect(
        shippingCostCents(2500, priceUsdCents: 300, freeOverUsdCents: 2500),
        0,
      );
      expect(
        shippingCostCents(2499, priceUsdCents: 300, freeOverUsdCents: 2500),
        300,
      );
    });

    test('sin mínimo siempre cobra', () {
      expect(
        shippingCostCents(999999, priceUsdCents: 600, freeOverUsdCents: null),
        600,
      );
    });
  });

  test('currencyFromApi conoce las cuatro monedas y rechaza otras', () {
    expect(currencyFromApi('USD'), Currency.usd);
    expect(currencyFromApi('VES'), Currency.ves);
    expect(currencyFromApi('EUR'), Currency.eur);
    expect(currencyFromApi('USDT'), Currency.usdt);
    expect(() => currencyFromApi('BTC'), throwsFormatException);
  });
}
