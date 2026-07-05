package {{packageName}};

import org.springframework.stereotype.Service;
import java.util.List;

/**
 * {{serviceName}} - {{description}}
 */
@Service
public class {{serviceName}}Service {

    private final {{repositoryName}}Repository {{repositoryNameLower}}Repository;

    public {{serviceName}}Service({{repositoryName}}Repository {{repositoryNameLower}}Repository) {
        this.{{repositoryNameLower}}Repository = {{repositoryNameLower}}Repository;
    }

    public List<{{entityName}}> findAll() {
        return {{repositoryNameLower}}Repository.findAll();
    }

    public {{entityName}} findById(Long id) {
        return {{repositoryNameLower}}Repository.findById(id)
            .orElseThrow(() -> new RuntimeException("Not found: " + id));
    }

    public {{entityName}} save({{entityName}} entity) {
        return {{repositoryNameLower}}Repository.save(entity);
    }

    public {{entityName}} update(Long id, {{entityName}} entity) {
        entity.setId(id);
        return {{repositoryNameLower}}Repository.save(entity);
    }

    public void delete(Long id) {
        {{repositoryNameLower}}Repository.deleteById(id);
    }
}
