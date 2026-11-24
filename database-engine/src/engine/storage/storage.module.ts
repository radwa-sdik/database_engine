import { Module } from '@nestjs/common';
import { CatalogService } from './catalog/catalog.service';
import { StorageManagerService } from './storage-manager.service';
import { MockDatabaseBootstrap } from './bootstrap/mock-database.bootstrap';

@Module({
    providers: [
        CatalogService,
        StorageManagerService,
        MockDatabaseBootstrap,
    ],
    exports: [CatalogService, StorageManagerService],
})
export class StorageModule {}
