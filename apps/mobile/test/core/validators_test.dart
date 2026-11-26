import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/validators.dart';

void main() {
  group('correo', () {
    test('acepta correos válidos, con espacios y mayúsculas', () {
      for (final ok in [
        'ana@petbf.com',
        '  Ana.Perez@Petbf.COM ',
        'ana+compras@mail.co.ve',
        "o'neil@example.org",
      ]) {
        expect(validateEmail(ok), isNull, reason: ok);
      }
      expect(normalizeEmail('  Ana@PETBF.com '), 'ana@petbf.com');
    });

    test('rechaza vacíos, mal formados y demasiado largos', () {
      expect(validateEmail(''), 'Escribe tu correo');
      expect(validateEmail('   '), 'Escribe tu correo');
      expect(validateEmail(null), 'Escribe tu correo');
      for (final bad in [
        'ana',
        'ana@',
        '@petbf.com',
        'ana@petbf',
        'ana@@petbf.com',
        'ana..perez@petbf.com',
        '.ana@petbf.com',
        'ana@petbf.c',
        'ana perez@petbf.com',
      ]) {
        expect(validateEmail(bad), 'Correo inválido', reason: bad);
      }
      final long = '${'a' * 250}@x.com';
      expect(validateEmail(long), 'Correo inválido');
    });
  });

  group('contraseñas', () {
    test('nueva: de 8 a 128 caracteres', () {
      expect(validateNewPassword(''), 'Escribe una contraseña');
      expect(
        validateNewPassword('1234567'),
        'La contraseña debe tener al menos 8 caracteres',
      );
      expect(validateNewPassword('12345678'), isNull);
      expect(validateNewPassword('a' * 128), isNull);
      expect(validateNewPassword('a' * 129), 'Máximo 128 caracteres');
    });

    test('al entrar solo exige que no esté vacía', () {
      expect(validateLoginPassword(''), 'Escribe tu contraseña');
      expect(validateLoginPassword('x'), isNull);
      expect(validateLoginPassword('a' * 129), 'Máximo 128 caracteres');
    });
  });

  group('textos', () {
    test('requiredText recorta y limita', () {
      final v = requiredText('tu nombre', 80);
      expect(v(''), 'Escribe tu nombre');
      expect(v('   '), 'Escribe tu nombre');
      expect(v(null), 'Escribe tu nombre');
      expect(v('Ana'), isNull);
      expect(v('a' * 80), isNull);
      expect(v('a' * 81), 'Máximo 80 caracteres');
      expect(v('  ${'a' * 80}  '), isNull); // los espacios no cuentan
    });

    test('optionalText permite vacío', () {
      final v = optionalText(200);
      expect(v(''), isNull);
      expect(v(null), isNull);
      expect(v('a' * 200), isNull);
      expect(v('a' * 201), 'Máximo 200 caracteres');
    });
  });

  group('teléfono venezolano', () {
    test('formatos aceptados', () {
      for (final ok in [
        '04121234567',
        '0412-1234567',
        '+58 412 1234567',
        '+584121234567',
        ' 0212-555-1234 ',
      ]) {
        expect(validatePhone(ok), isNull, reason: ok);
      }
    });

    test('formatos rechazados', () {
      expect(validatePhone(''), 'Escribe un teléfono');
      for (final bad in [
        '12345',
        '0412 abc 4567',
        '(0412)1234567',
        '0' * 17,
        '++584121234567',
      ]) {
        expect(
          validatePhone(bad),
          startsWith('Teléfono inválido'),
          reason: bad,
        );
      }
    });

    test('opcional en el registro', () {
      expect(validateOptionalPhone(''), isNull);
      expect(validateOptionalPhone('  '), isNull);
      expect(validateOptionalPhone('123'), startsWith('Teléfono inválido'));
    });
  });

  test('estado: solo las 24 entidades', () {
    expect(veStates, hasLength(24));
    expect(validateState(null), 'Elige un estado');
    expect(validateState(''), 'Elige un estado');
    expect(validateState('Zulia'), isNull);
    expect(validateState('Distrito Capital'), isNull);
    expect(validateState('Caracas'), 'Estado inválido');
    expect(validateState('zulia'), 'Estado inválido');
  });

  group('referencia del pago', () {
    test('se normaliza sin espacios y en mayúsculas', () {
      expect(normalizeReference(' ab 12-34 \n'), 'AB12-34');
    });

    test('de 4 a 40 letras, números o guiones', () {
      expect(validateReference(''), 'Escribe la referencia del pago');
      expect(validateReference('   '), 'Escribe la referencia del pago');
      expect(validateReference('123'), startsWith('Referencia inválida'));
      expect(validateReference('1234'), isNull);
      expect(validateReference('ab 12 34'), isNull);
      expect(validateReference('A' * 40), isNull);
      expect(validateReference('A' * 41), startsWith('Referencia inválida'));
      expect(validateReference('12#4'), startsWith('Referencia inválida'));
      expect(validateReference('ÑAÑA'), startsWith('Referencia inválida'));
    });
  });

  group('monto pagado', () {
    test('acepta punto o coma decimal y lo convierte a punto', () {
      expect(normalizeAmount('123,45'), '123.45');
      expect(normalizeAmount('123.45'), '123.45');
      expect(normalizeAmount(' 100 '), '100');
      expect(normalizeAmount('0,5'), '0.5');
      expect(validateAmount('908,85'), isNull);
      expect(validateAmount('908.85'), isNull);
    });

    test('rechaza vacíos, ceros, letras, separadores de miles y más de 2 decimales', () {
      expect(validateAmount(''), 'Escribe el monto que pagaste');
      expect(validateAmount('0'), 'El monto debe ser mayor que cero');
      expect(validateAmount('0,00'), 'El monto debe ser mayor que cero');
      expect(
        validateAmount('1.234,50'),
        startsWith('Escribe el monto sin separador'),
      );
      expect(validateAmount('12,345'), startsWith('Monto inválido'));
      expect(validateAmount('abc'), startsWith('Monto inválido'));
      expect(validateAmount('-5'), startsWith('Monto inválido'));
      expect(validateAmount('1e3'), startsWith('Monto inválido'));
      expect(validateAmount('1' * 13), startsWith('Monto inválido'));
      expect(validateAmount('1' * 12), isNull);
      expect(normalizeAmount('1.234,50'), isNull);
    });
  });

  group('fecha del pago', () {
    final created = DateTime.utc(2026, 11, 26, 14);
    final now = DateTime.utc(2026, 11, 26, 15);

    test('válida entre el pedido y ahora (con 10 min de margen)', () {
      expect(validatePaidAt(now, orderCreatedAt: created, now: now), isNull);
      expect(
        validatePaidAt(
          created.subtract(const Duration(minutes: 9)),
          orderCreatedAt: created,
          now: now,
        ),
        isNull,
      );
      expect(
        validatePaidAt(
          now.add(const Duration(minutes: 9)),
          orderCreatedAt: created,
          now: now,
        ),
        isNull,
      );
    });

    test('rechaza futuro, anterior al pedido o vacía', () {
      expect(
        validatePaidAt(null, orderCreatedAt: created, now: now),
        'Indica cuándo pagaste',
      );
      expect(
        validatePaidAt(
          now.add(const Duration(minutes: 11)),
          orderCreatedAt: created,
          now: now,
        ),
        'La fecha del pago no puede estar en el futuro',
      );
      expect(
        validatePaidAt(
          created.subtract(const Duration(minutes: 11)),
          orderCreatedAt: created,
          now: now,
        ),
        'La fecha del pago es anterior al pedido',
      );
    });
  });

  test('búsqueda: mínimo 2 letras y máximo 80', () {
    expect(searchQuery(''), isNull);
    expect(searchQuery(' a '), isNull);
    expect(searchQuery(' ab '), 'ab');
    expect(searchQuery('x' * 100), hasLength(80));
  });
}
