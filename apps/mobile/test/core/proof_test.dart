import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/proof.dart';

Uint8List bytes(List<int> head, [int size = 16]) =>
    Uint8List(size < head.length ? head.length : size)..setAll(0, head);

void main() {
  group('tipo real del comprobante', () {
    test('reconoce JPG, PNG, WebP y PDF por sus primeros bytes', () {
      expect(sniffProofType(bytes([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
      expect(
        sniffProofType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        'image/png',
      );
      expect(
        sniffProofType(
          bytes([...'RIFF'.codeUnits, 0, 0, 0, 0, ...'WEBP'.codeUnits]),
        ),
        'image/webp',
      );
      expect(sniffProofType(bytes('%PDF-1.4'.codeUnits)), 'application/pdf');
    });

    test('rechaza otros tipos y archivos cortos', () {
      expect(sniffProofType(bytes('GIF89a'.codeUnits)), isNull);
      expect(sniffProofType(Uint8List.fromList([0xff, 0xd8])), isNull);
      expect(sniffProofType(bytes('RIFF....AVI '.codeUnits)), isNull);
      expect(sniffProofType(Uint8List(0)), isNull);
    });
  });

  group('checkProof', () {
    test('acepta un archivo válido de hasta 5 MB', () {
      final proof = checkProof(
        'pago.pdf',
        bytes('%PDF-'.codeUnits, maxProofBytes),
      );
      expect(proof.contentType, 'application/pdf');
      expect(proof.name, 'pago.pdf');
    });

    test('rechaza vacío, más de 5 MB o de otro tipo', () {
      Matcher error(String message) => throwsA(
        isA<ProofError>().having((e) => e.message, 'message', message),
      );
      expect(
        () => checkProof('a.png', Uint8List(0)),
        error('El archivo está vacío'),
      );
      expect(
        () => checkProof('a.pdf', bytes('%PDF-'.codeUnits, maxProofBytes + 1)),
        error(proofTooBigMessage),
      );
      // La extensión no basta: manda el contenido.
      expect(
        () => checkProof('a.png', Uint8List(64)),
        error(proofWrongTypeMessage),
      );
    });
  });

  test('tamaños legibles', () {
    expect(formatBytes(1), '1 KB');
    expect(formatBytes(2048), '2 KB');
    expect(formatBytes(1572864), '1,5 MB');
    expect(formatBytes(maxProofBytes), '5,0 MB');
  });
}
