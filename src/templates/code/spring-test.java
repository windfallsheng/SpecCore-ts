package {{packageName}};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

/**
 * {{testName}} - {{description}}
 */
@SpringBootTest
public class {{testName}}Test {

    @Autowired
    private {{serviceName}}Service {{serviceNameLower}}Service;

    @Test
    void testCreate() {
        // Arrange
        {{entityName}} entity = new {{entityName}}();
        
        // Act
        {{entityName}} result = {{serviceNameLower}}Service.save(entity);
        
        // Assert
        assertNotNull(result);
    }

    @Test
    void testFindById() {
        // Arrange
        Long id = 1L;
        
        // Act
        {{entityName}} result = {{serviceNameLower}}Service.findById(id);
        
        // Assert
        assertNotNull(result);
    }
}
