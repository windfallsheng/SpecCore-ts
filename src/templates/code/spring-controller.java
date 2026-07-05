package {{packageName}};

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.List;

/**
 * {{controllerName}} - {{description}}
 */
@RestController
@RequestMapping("{{basePath}}")
public class {{controllerName}}Controller {

    private final {{serviceName}}Service {{serviceNameLower}}Service;

    public {{controllerName}}Controller({{serviceName}}Service {{serviceNameLower}}Service) {
        this.{{serviceNameLower}}Service = {{serviceNameLower}}Service;
    }

    @GetMapping
    public ResponseEntity<List<{{entityName}}>> list() {
        return ResponseEntity.ok({{serviceNameLower}}Service.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<{{entityName}}> getById(@PathVariable Long id) {
        return ResponseEntity.ok({{serviceNameLower}}Service.findById(id));
    }

    @PostMapping
    public ResponseEntity<{{entityName}}> create(@RequestBody {{entityName}} entity) {
        return ResponseEntity.ok({{serviceNameLower}}Service.save(entity));
    }

    @PutMapping("/{id}")
    public ResponseEntity<{{entityName}}> update(@PathVariable Long id, @RequestBody {{entityName}} entity) {
        return ResponseEntity.ok({{serviceNameLower}}Service.update(id, entity));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        {{serviceNameLower}}Service.delete(id);
        return ResponseEntity.ok().build();
    }
}
