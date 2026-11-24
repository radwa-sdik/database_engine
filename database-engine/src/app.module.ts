import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiModule } from './api/api.module';
import { SqlModule } from './engine/sql/sql.module';
import { StorageModule } from './engine/storage/storage.module';

@Module({
  imports: [ApiModule, SqlModule, StorageModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
