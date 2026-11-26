import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { slugSchema } from '../common/slug.js';
import {
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  createVariantSchema,
  listProductsManageSchema,
  listProductsSchema,
  setImagesSchema,
  updateCategorySchema,
  updateProductSchema,
  updateVariantSchema,
  type CreateBrandDto,
  type CreateCategoryDto,
  type CreateProductDto,
  type CreateVariantDto,
  type ListProductsManageQuery,
  type ListProductsQuery,
  type SetImagesDto,
  type UpdateCategoryDto,
  type UpdateProductDto,
  type UpdateVariantDto,
} from './catalog.schemas.js';
import { CatalogService } from './catalog.service.js';

const id = z.uuid('Id inválido');

// Lectura pública del catálogo.
@Public()
@Controller()
export class CatalogPublicController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories() {
    return this.catalog.listCategories();
  }

  @Get('brands')
  brands() {
    return this.catalog.listBrands();
  }

  @Get('products')
  products(@Query({ schema: listProductsSchema }) query: ListProductsQuery) {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  product(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.catalog.getProduct(slug);
  }
}

// Gestión del catálogo: gestor de catálogo (y ADMIN).
@Roles(['CATALOG_MANAGER'])
@Controller('manage')
export class CatalogManageController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  products(
    @Query({ schema: listProductsManageSchema }) query: ListProductsManageQuery,
  ) {
    return this.catalog.listProducts(query, true);
  }

  @Get('products/:slug')
  product(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.catalog.getProduct(slug, true);
  }

  @Post('categories')
  createCategory(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createCategorySchema }) dto: CreateCategoryDto,
  ) {
    return this.catalog.createCategory(actor, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) categoryId: string,
    @Body({ schema: updateCategorySchema }) dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(actor, categoryId, dto);
  }

  @Post('brands')
  createBrand(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createBrandSchema }) dto: CreateBrandDto,
  ) {
    return this.catalog.createBrand(actor, dto);
  }

  @Post('products')
  createProduct(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createProductSchema }) dto: CreateProductDto,
  ) {
    return this.catalog.createProduct(actor, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) productId: string,
    @Body({ schema: updateProductSchema }) dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(actor, productId, dto);
  }

  @Put('products/:id/images')
  setImages(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) productId: string,
    @Body({ schema: setImagesSchema }) dto: SetImagesDto,
  ) {
    return this.catalog.setImages(actor, productId, dto);
  }

  @Post('products/:id/variants')
  createVariant(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) productId: string,
    @Body({ schema: createVariantSchema }) dto: CreateVariantDto,
  ) {
    return this.catalog.createVariant(actor, productId, dto);
  }

  @Patch('variants/:id')
  updateVariant(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) variantId: string,
    @Body({ schema: updateVariantSchema }) dto: UpdateVariantDto,
  ) {
    return this.catalog.updateVariant(actor, variantId, dto);
  }
}
