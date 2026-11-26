import 'json.dart';

enum Species { dog, cat, bird, fish, rodent, reptile, other }

const _speciesApi = {
  Species.dog: 'DOG',
  Species.cat: 'CAT',
  Species.bird: 'BIRD',
  Species.fish: 'FISH',
  Species.rodent: 'RODENT',
  Species.reptile: 'REPTILE',
  Species.other: 'OTHER',
};

extension SpeciesApi on Species {
  String get api => _speciesApi[this]!;

  /// Como en la web: "Perros", "Gatos"...
  String get label => switch (this) {
    Species.dog => 'Perros',
    Species.cat => 'Gatos',
    Species.bird => 'Aves',
    Species.fish => 'Peces',
    Species.rodent => 'Roedores',
    Species.reptile => 'Reptiles',
    Species.other => 'Otros',
  };

  /// En singular, para la ficha de un animal.
  String get singular => switch (this) {
    Species.dog => 'Perro',
    Species.cat => 'Gato',
    Species.bird => 'Ave',
    Species.fish => 'Pez',
    Species.rodent => 'Roedor',
    Species.reptile => 'Reptil',
    Species.other => 'Otro',
  };
}

Species speciesFromApi(String value) => _speciesApi.entries
    .firstWhere(
      (e) => e.value == value,
      orElse: () => throw FormatException('Especie desconocida: $value'),
    )
    .key;

class ImageRef {
  const ImageRef({required this.url, required this.alt});
  factory ImageRef.fromJson(Json json) =>
      ImageRef(url: json.str('url'), alt: json.str('alt'));
  final String url;
  final String alt;
}

class Category {
  const Category({
    required this.id,
    required this.name,
    required this.slug,
    required this.parentId,
  });
  factory Category.fromJson(Json json) => Category(
    id: json.str('id'),
    name: json.str('name'),
    slug: json.str('slug'),
    parentId: json.strOrNull('parentId'),
  );
  final String id;
  final String name;
  final String slug;
  final String? parentId;
}

/// Promedio (redondeado a un decimal) y número de reseñas visibles.
class Rating {
  const Rating({this.average, this.count = 0});
  factory Rating.fromJson(Json json) => Rating(
    average: switch (json['average']) {
      final num n => n.toDouble(),
      null => null,
      final other => throw FormatException('Promedio inválido: $other'),
    },
    count: json.integer('count'),
  );

  /// Lee `rating` si viene; una API anterior no lo manda.
  static Rating of(Json json) => json.objOrNull('rating') == null
      ? const Rating()
      : Rating.fromJson(json.obj('rating'));

  final double? average;
  final int count;

  bool get hasReviews => average != null && count > 0;

  /// "4,5"
  String get averageText =>
      average == null ? '' : average!.toStringAsFixed(1).replaceAll('.', ',');

  /// "4,5 de 5 estrellas, 12 reseñas", para lectores de pantalla.
  String get semantics =>
      '$averageText de 5 estrellas, $count ${count == 1 ? 'reseña' : 'reseñas'}';
}

class ProductCard {
  const ProductCard({
    required this.id,
    required this.name,
    required this.slug,
    required this.species,
    required this.categoryName,
    required this.brandName,
    required this.image,
    required this.priceFromUsdCents,
    required this.compareAtUsdCents,
    required this.inStock,
    this.rating = const Rating(),
  });

  factory ProductCard.fromJson(Json json) => ProductCard(
    id: json.str('id'),
    name: json.str('name'),
    slug: json.str('slug'),
    species: json.strings('species').map(speciesFromApi).toList(),
    categoryName: json.obj('category').str('name'),
    brandName: json.objOrNull('brand')?.str('name'),
    image: json.objOrNull('image') == null
        ? null
        : ImageRef.fromJson(json.obj('image')),
    priceFromUsdCents: json.intOrNull('priceFromUsdCents'),
    compareAtUsdCents: json.intOrNull('compareAtUsdCents'),
    inStock: json.boolean('inStock'),
    rating: Rating.of(json),
  );

  final String id;
  final String name;
  final String slug;
  final List<Species> species;
  final Rating rating;
  final String categoryName;
  final String? brandName;
  final ImageRef? image;
  final int? priceFromUsdCents;
  final int? compareAtUsdCents;
  final bool inStock;
}

class Variant {
  const Variant({
    required this.id,
    required this.sku,
    required this.name,
    required this.priceUsdCents,
    required this.compareAtUsdCents,
    required this.inStock,
  });
  factory Variant.fromJson(Json json) => Variant(
    id: json.str('id'),
    sku: json.str('sku'),
    name: json.str('name'),
    priceUsdCents: json.integer('priceUsdCents'),
    compareAtUsdCents: json.intOrNull('compareAtUsdCents'),
    inStock: json.boolean('inStock'),
  );
  final String id;
  final String sku;
  final String name;
  final int priceUsdCents;
  final int? compareAtUsdCents;
  final bool inStock;
}

class ProductDetail {
  const ProductDetail({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    required this.species,
    required this.isReturnable,
    required this.categoryName,
    required this.categorySlug,
    required this.brandName,
    required this.images,
    required this.variants,
    this.rating = const Rating(),
  });

  factory ProductDetail.fromJson(Json json) => ProductDetail(
    id: json.str('id'),
    name: json.str('name'),
    slug: json.str('slug'),
    description: json.str('description'),
    species: json.strings('species').map(speciesFromApi).toList(),
    isReturnable: json.boolean('isReturnable'),
    categoryName: json.obj('category').str('name'),
    categorySlug: json.obj('category').str('slug'),
    brandName: json.objOrNull('brand')?.str('name'),
    images: asList(json['images'], ImageRef.fromJson),
    variants: asList(json['variants'], Variant.fromJson),
    rating: Rating.of(json),
  );

  final Rating rating;

  final String id;
  final String name;
  final String slug;
  final String description;
  final List<Species> species;
  final bool isReturnable;
  final String categoryName;
  final String categorySlug;
  final String? brandName;
  final List<ImageRef> images;
  final List<Variant> variants;
}

enum ListingType { sale, adoption }

enum AnimalStatus { available, reserved, sold, adopted, unavailable }

enum Sex { male, female, unknown }

extension SexLabel on Sex {
  String get label => switch (this) {
    Sex.male => 'Macho',
    Sex.female => 'Hembra',
    Sex.unknown => 'Sin determinar',
  };
}

class Animal {
  const Animal({
    required this.id,
    required this.name,
    required this.slug,
    required this.listingType,
    required this.status,
    required this.species,
    required this.breed,
    required this.sex,
    required this.birthDate,
    required this.description,
    required this.priceUsdCents,
    required this.isVaccinated,
    required this.isSterilized,
    required this.images,
  });

  factory Animal.fromJson(Json json) => Animal(
    id: json.str('id'),
    name: json.str('name'),
    slug: json.str('slug'),
    listingType: switch (json.str('listingType')) {
      'SALE' => ListingType.sale,
      'ADOPTION' => ListingType.adoption,
      final other => throw FormatException('Tipo desconocido: $other'),
    },
    status: switch (json.str('status')) {
      'AVAILABLE' => AnimalStatus.available,
      'RESERVED' => AnimalStatus.reserved,
      'SOLD' => AnimalStatus.sold,
      'ADOPTED' => AnimalStatus.adopted,
      'UNAVAILABLE' => AnimalStatus.unavailable,
      final other => throw FormatException('Estado desconocido: $other'),
    },
    species: speciesFromApi(json.str('species')),
    breed: json.strOrNull('breed'),
    sex: switch (json.str('sex')) {
      'MALE' => Sex.male,
      'FEMALE' => Sex.female,
      _ => Sex.unknown,
    },
    birthDate: json.dateOrNull('birthDate'),
    description: json.str('description'),
    priceUsdCents: json.intOrNull('priceUsdCents'),
    isVaccinated: json.boolean('isVaccinated'),
    isSterilized: json.boolean('isSterilized'),
    images: asList(json['images'], ImageRef.fromJson),
  );

  final String id;
  final String name;
  final String slug;
  final ListingType listingType;
  final AnimalStatus status;
  final Species species;
  final String? breed;
  final Sex sex;
  final DateTime? birthDate;
  final String description;
  final int? priceUsdCents;
  final bool isVaccinated;
  final bool isSterilized;
  final List<ImageRef> images;
}

/// Tasas del BCV vigentes (Bs por 1 USD y por 1 EUR).
class Rates {
  const Rates({this.usdVes, this.eurVes, this.usdEffectiveAt});

  factory Rates.fromJson(Json json) {
    final usd = json.objOrNull('usdVes');
    final eur = json.objOrNull('eurVes');
    return Rates(
      usdVes: usd?.decimal('rate'),
      eurVes: eur?.decimal('rate'),
      usdEffectiveAt: usd?.date('effectiveAt'),
    );
  }

  final String? usdVes;
  final String? eurVes;
  final DateTime? usdEffectiveAt;
}
