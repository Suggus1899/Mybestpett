import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/format.dart';
import 'package:petbf/core/money.dart';

void main() {
  group('dinero con formato de Venezuela', () {
    test('formatCents agrupa miles con punto y usa coma decimal', () {
      expect(formatCents(0), '0,00');
      expect(formatCents(5), '0,05');
      expect(formatCents(1250), '12,50');
      expect(formatCents(100000), '1.000,00');
      expect(formatCents(123456789), '1.234.567,89');
      expect(formatCents(-1250), '-12,50');
    });

    test('formatUsd y formatBs como la web', () {
      expect(formatUsd(2490), r'$24,90');
      expect(formatBs(2490, '36.5'), 'Bs. 908,85');
      expect(formatBs(100000, '36.5'), 'Bs. 36.500,00');
    });

    test('formatMoney en cada moneda', () {
      expect(formatMoney('908.85', Currency.ves), 'Bs. 908,85');
      expect(formatMoney('24.9', Currency.usd), r'$24,90');
      expect(formatMoney('9.17', Currency.eur), '9,17 €');
      expect(formatMoney('24.90', Currency.usdt), '24,90 USDT');
    });

    test('discountPercent redondea', () {
      expect(discountPercent(2990, 2490), 17);
      expect(discountPercent(1000, 500), 50);
    });
  });

  group('fechas en hora de Caracas (UTC-4)', () {
    test('convierte desde UTC aunque cambie el día', () {
      final instant = DateTime.utc(
        2026,
        11,
        27,
        3,
        30,
      ); // 26 nov 23:30 en Caracas
      expect(formatDate(instant), '26 nov 2026');
      expect(formatTime(instant), '11:30 p. m.');
      expect(formatDateTime(instant), '26 nov 2026, 11:30 p. m.');
    });

    test('mediodía y medianoche', () {
      expect(formatTime(DateTime.utc(2026, 1, 1, 16)), '12:00 p. m.');
      expect(formatTime(DateTime.utc(2026, 1, 1, 4, 5)), '12:05 a. m.');
      expect(formatTime(DateTime.utc(2026, 1, 1, 13, 9)), '9:09 a. m.');
    });

    test('formatLocalDateTime no convierte la hora elegida', () {
      expect(
        formatLocalDateTime(DateTime(2026, 9, 3, 14, 7)),
        '3 sept 2026, 2:07 p. m.',
      );
    });
  });

  group('formatRemaining', () {
    test('horas y minutos', () {
      expect(
        formatRemaining(const Duration(hours: 1, minutes: 5)),
        '1 h 05 min',
      );
      expect(formatRemaining(const Duration(hours: 2)), '2 h 00 min');
      expect(
        formatRemaining(const Duration(minutes: 12, seconds: 40)),
        '12 min',
      );
      expect(formatRemaining(const Duration(seconds: 59)), 'menos de 1 min');
      expect(formatRemaining(Duration.zero), 'menos de 1 min');
    });
  });

  group('formatAge (como la web)', () {
    final now = DateTime(2026, 11, 26);
    test('menos de un mes', () {
      expect(formatAge(DateTime(2026, 11, 1), now), 'Menos de un mes');
      expect(formatAge(DateTime(2026, 10, 27), now), 'Menos de un mes');
    });
    test('meses', () {
      expect(formatAge(DateTime(2026, 10, 26), now), '1 mes');
      expect(formatAge(DateTime(2026, 7, 10), now), '4 meses');
    });
    test('años y meses', () {
      expect(formatAge(DateTime(2025, 11, 26), now), '1 año');
      expect(formatAge(DateTime(2025, 8, 1), now), '1 año y 3 meses');
      expect(formatAge(DateTime(2023, 10, 1), now), '3 años y 1 mes');
      expect(formatAge(DateTime(2022, 11, 26), now), '4 años');
    });
  });
}
