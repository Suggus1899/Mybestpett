import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

/// Igual que la API: hasta 5 MB.
const maxProofBytes = 5 * 1024 * 1024;

const proofTooBigMessage = 'El comprobante pesa más de 5 MB';
const proofWrongTypeMessage =
    'El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF';

/// Comprobante elegido por la persona, ya leído y validado.
class PickedProof {
  const PickedProof({
    required this.name,
    required this.bytes,
    required this.contentType,
  });
  final String name;
  final Uint8List bytes;
  final String contentType;
}

/// El archivo elegido no sirve como comprobante.
class ProofError implements Exception {
  const ProofError(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Tipo real según los primeros bytes, como la API: el nombre o la
/// extensión se pueden falsear.
String? sniffProofType(Uint8List data) {
  bool starts(List<int> bytes, [int offset = 0]) =>
      data.length >= offset + bytes.length &&
      [for (var i = 0; i < bytes.length; i++) data[offset + i] == bytes[i]]
          .every((ok) => ok);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (starts('RIFF'.codeUnits) && starts('WEBP'.codeUnits, 8)) {
    return 'image/webp';
  }
  if (starts('%PDF-'.codeUnits)) return 'application/pdf';
  return null;
}

/// Valida un archivo leído y lo convierte en [PickedProof].
PickedProof checkProof(String name, Uint8List bytes) {
  if (bytes.isEmpty) throw const ProofError('El archivo está vacío');
  if (bytes.length > maxProofBytes) throw const ProofError(proofTooBigMessage);
  final type = sniffProofType(bytes);
  if (type == null) throw const ProofError(proofWrongTypeMessage);
  return PickedProof(name: name, bytes: bytes, contentType: type);
}

/// Abre el selector de archivos del sistema. Se sustituye en las pruebas.
abstract interface class ProofPicker {
  /// null si la persona cancela; [ProofError] si el archivo no sirve.
  Future<PickedProof?> pick();
}

class SystemProofPicker implements ProofPicker {
  const SystemProofPicker();

  @override
  Future<PickedProof?> pick() async {
    final file = await FilePicker.pickFile(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    );
    if (file == null) return null;
    // El tamaño se mira antes de leer: no carga en memoria un video de 1 GB.
    final size = file.lengthSync() ?? await file.length();
    if (size != null && size > maxProofBytes) {
      throw const ProofError(proofTooBigMessage);
    }
    return checkProof(file.name, await file.readAsBytes());
  }
}

/// "230 KB", "1,4 MB".
String formatBytes(int bytes) {
  if (bytes < 1024 * 1024) return '${(bytes / 1024).ceil()} KB';
  final mb = (bytes / (1024 * 1024)).toStringAsFixed(1).replaceAll('.', ',');
  return '$mb MB';
}
