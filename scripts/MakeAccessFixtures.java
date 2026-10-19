// Writes tests/fixtures/shop.accdb (Access 2010) and tests/fixtures/shop.mdb (Access 2000), the Access source
// fixtures: a customers table and an orders table with most Access column types (AutoNumber, Text, Long Text,
// Currency, Number, Date/Time, Yes/No), empty values, accented text, and an empty table.
// Nothing in Node writes Access files, so this uses Jackcess (Apache 2.0). Run it after changing it, and commit both files:
//   curl -sSfLO https://repo1.maven.org/maven2/com/healthmarketscience/jackcess/jackcess/4.0.8/jackcess-4.0.8.jar
//   curl -sSfLO https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar
//   curl -sSfLO https://repo1.maven.org/maven2/commons-logging/commons-logging/1.3.4/commons-logging-1.3.4.jar
//   java -cp 'jackcess-4.0.8.jar:commons-lang3-3.17.0.jar:commons-logging-1.3.4.jar' scripts/MakeAccessFixtures.java
import com.healthmarketscience.jackcess.ColumnBuilder;
import com.healthmarketscience.jackcess.DataType;
import com.healthmarketscience.jackcess.Database;
import com.healthmarketscience.jackcess.DatabaseBuilder;
import com.healthmarketscience.jackcess.DateTimeType;
import com.healthmarketscience.jackcess.Table;
import com.healthmarketscience.jackcess.TableBuilder;
import java.io.File;
import java.math.BigDecimal;
import java.time.LocalDateTime;

public class MakeAccessFixtures {
  public static void main(String[] args) throws Exception {
    write(new File("tests/fixtures/shop.accdb"), Database.FileFormat.V2010);
    write(new File("tests/fixtures/shop.mdb"), Database.FileFormat.V2000);
  }

  static void write(File file, Database.FileFormat format) throws Exception {
    file.delete();
    try (Database db = new DatabaseBuilder(file).setFileFormat(format).create()) {
      db.setDateTimeType(DateTimeType.LOCAL_DATE_TIME);
      Table customers = new TableBuilder("Customers")
          .addColumn(new ColumnBuilder("CustomerID", DataType.LONG).setAutoNumber(true))
          .addColumn(new ColumnBuilder("Name", DataType.TEXT))
          .addColumn(new ColumnBuilder("Email", DataType.TEXT))
          .addColumn(new ColumnBuilder("Joined", DataType.SHORT_DATE_TIME))
          .addColumn(new ColumnBuilder("Active", DataType.BOOLEAN))
          .addColumn(new ColumnBuilder("CreditLimit", DataType.MONEY))
          .setPrimaryKey("CustomerID")
          .toTable(db);
      customers.addRow(null, "Ann Lee", "ann@example.com", LocalDateTime.of(2025, 3, 14, 0, 0), true, new BigDecimal("1500.00"));
      customers.addRow(null, "Bob Ray", null, LocalDateTime.of(2025, 7, 1, 9, 30), false, new BigDecimal("250.50"));
      customers.addRow(null, "Zoë Café", "zoe@example.com", LocalDateTime.of(2026, 1, 20, 17, 45, 10), true, null);

      Table orders = new TableBuilder("Orders")
          .addColumn(new ColumnBuilder("OrderID", DataType.LONG).setAutoNumber(true))
          .addColumn(new ColumnBuilder("CustomerID", DataType.LONG))
          .addColumn(new ColumnBuilder("OrderDate", DataType.SHORT_DATE_TIME))
          .addColumn(new ColumnBuilder("Quantity", DataType.INT))
          .addColumn(new ColumnBuilder("Weight", DataType.DOUBLE))
          .addColumn(new ColumnBuilder("Discount", DataType.FLOAT))
          .addColumn(new ColumnBuilder("Priority", DataType.BYTE))
          .addColumn(new ColumnBuilder("Amount", DataType.MONEY))
          .addColumn(new ColumnBuilder("Notes", DataType.MEMO))
          .addColumn(new ColumnBuilder("Shipped", DataType.BOOLEAN))
          .setPrimaryKey("OrderID")
          .toTable(db);
      orders.addRow(null, 1, LocalDateTime.of(2026, 1, 5, 0, 0), 3, 1.25, 0.5f, 1, new BigDecimal("120.50"), "Leave at the door", true);
      orders.addRow(null, 2, LocalDateTime.of(2026, 2, 10, 14, 5), 1, 0.4, 0f, 2, new BigDecimal("80.00"), null, false);
      orders.addRow(null, 1, LocalDateTime.of(2026, 3, 15, 0, 0), 12, null, 0.25f, 1, new BigDecimal("42.25"), "Gift wrap, café box", true);
      orders.addRow(null, 3, null, null, 2.0, null, null, null, "", false);

      new TableBuilder("Archive")
          .addColumn(new ColumnBuilder("ID", DataType.LONG))
          .addColumn(new ColumnBuilder("Note", DataType.TEXT))
          .toTable(db);
    }
  }
}
