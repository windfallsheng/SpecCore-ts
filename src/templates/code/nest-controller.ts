import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { {{serviceName}}Service } from './{{serviceNameLower}}.service';

@Controller('{{basePath}}')
export class {{controllerName}}Controller {
  constructor(private readonly {{serviceNameLower}}Service: {{serviceName}}Service) {}

  @Get()
  findAll() {
    return this.{{serviceNameLower}}Service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.{{serviceNameLower}}Service.findOne(id);
  }

  @Post()
  create(@Body() createDto: any) {
    return this.{{serviceNameLower}}Service.create(createDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDto: any) {
    return this.{{serviceNameLower}}Service.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.{{serviceNameLower}}Service.remove(id);
  }
}
